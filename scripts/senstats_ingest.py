#!/usr/bin/env python3
"""Daily SenStats data ingestion for Firestore.

Fetches Canadian senator metadata from Open North Represent and performs a
light-touch scrape of Senate of Canada proactive disclosure pages. Designed for
GitHub Actions with credentials supplied through environment variables.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import logging
import os
import random
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
except ImportError:  # pragma: no cover - surfaced by main logging in CI
    firebase_admin = None
    credentials = None
    firestore = None

REPRESENT_BASE_URL = "https://represent.opennorth.ca"
SENATE_DISCLOSURE_URL = "https://sencanada.ca/en/proactive/summary/"
SENATE_SENATORS_AJAX_URL = "https://sencanada.ca/umbraco/surface/SenatorsAjax/GetSenators?Lang=en&displayFor=senatorslist"
DEFAULT_USER_AGENT = "SenStats-Data-Sync/1.0 (Contact: configure-SENSTATS_CONTACT_EMAIL)"
LOG_PATH = os.getenv("SENSTATS_ERROR_LOG", "senstats_ingest_errors.log")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.StreamHandler(sys.stdout), logging.FileHandler(LOG_PATH, encoding="utf-8")],
)
LOGGER = logging.getLogger("senstats_ingest")


@dataclass(frozen=True)
class SenatorRecord:
    senator_id: str
    name: str
    party: str
    province: str
    office_details: list[dict[str, Any]]
    source_url: str
    photo_url: str | None = None


@dataclass(frozen=True)
class ExpenseRecord:
    senator_id: str
    senator_name: str
    quarter: str
    amount: float
    category: str
    source_url: str
    raw: dict[str, Any]


def polite_delay() -> None:
    """Randomized 2-5 second delay to avoid hammering public sites."""
    time.sleep(random.uniform(2, 5))


def session() -> requests.Session:
    contact_email = os.getenv("SENSTATS_CONTACT_EMAIL", "configure-SENSTATS_CONTACT_EMAIL")
    user_agent = os.getenv("SENSTATS_USER_AGENT", f"SenStats-Data-Sync/1.0 (Contact: {contact_email})")
    http = requests.Session()
    http.headers.update({"User-Agent": user_agent or DEFAULT_USER_AGENT, "Accept": "application/json,text/html,*/*"})
    return http


def safe_get(http: requests.Session, url: str, *, expect_json: bool = False) -> requests.Response | None:
    try:
        polite_delay()
        response = http.get(url, timeout=30)
        response.raise_for_status()
        if expect_json and "json" not in response.headers.get("content-type", ""):
            LOGGER.warning("Expected JSON but got %s from %s", response.headers.get("content-type"), url)
        return response
    except requests.RequestException as exc:
        LOGGER.error("Request failed for %s: %s", url, exc, exc_info=True)
        return None


def stable_id(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return cleaned or hashlib.sha1(value.encode("utf-8")).hexdigest()[:12]


def fetch_current_senators(http: requests.Session) -> list[SenatorRecord]:
    """Fetch current Canadian senators from Represent.

    Represent exposes paginated JSON endpoints and supports filtering by
    `elected_office`; the fallback endpoint keeps the sync resilient if a
    Senate-specific representative set is absent.
    """
    candidates = [
        f"{REPRESENT_BASE_URL}/representatives/senate/?limit=1000",
        f"{REPRESENT_BASE_URL}/representatives/?elected_office=Senator&limit=1000",
    ]
    for first_url in candidates:
        senators: list[SenatorRecord] = []
        next_url: str | None = first_url
        while next_url:
            response = safe_get(http, next_url, expect_json=True)
            if response is None:
                break
            try:
                payload = response.json()
            except json.JSONDecodeError as exc:
                LOGGER.error("Represent JSON parse failed for %s: %s", next_url, exc, exc_info=True)
                break
            for item in payload.get("objects", []):
                office = str(item.get("elected_office", ""))
                if office and "senator" not in office.lower() and "senate" not in first_url:
                    continue
                name = str(item.get("name") or "").strip()
                if not name:
                    LOGGER.warning("Skipping senator row without name: %s", item)
                    continue
                senators.append(
                    SenatorRecord(
                        senator_id=stable_id(name),
                        name=name,
                        party=str(item.get("party_name") or "Independent/Unknown"),
                        province=str(item.get("district_name") or item.get("extra", {}).get("province") or "Unknown"),
                        office_details=list(item.get("offices") or []),
                        source_url=str(item.get("source_url") or item.get("url") or REPRESENT_BASE_URL),
                        photo_url=item.get("photo_url"),
                    )
                )
            meta = payload.get("meta") or {}
            next_path = meta.get("next")
            next_url = urljoin(REPRESENT_BASE_URL, next_path) if next_path else None
        if senators:
            LOGGER.info("Fetched %s senators from %s", len(senators), first_url)
            return senators
    LOGGER.warning("No senator metadata could be fetched from Represent endpoints; falling back to official Senate list.")
    return fetch_senate_website_senators(http)


def party_label(value: str) -> str:
    labels = {
        "C": "Conservative Party of Canada",
        "CSG": "Canadian Senators Group",
        "GRO": "Government Representative's Office",
        "ISG": "Independent Senators Group",
        "PSG": "Progressive Senate Group",
        "Non-affiliated": "Non-affiliated",
    }
    return labels.get(value.strip(), value.strip() or "Independent/Unknown")


def fetch_senate_website_senators(http: requests.Session) -> list[SenatorRecord]:
    """Fallback to the official Senate current-senators AJAX endpoint.

    Open North does not always expose Canadian senators as a representative set.
    The official Senate endpoint is therefore used as a resilient fallback so the
    Firestore collection is populated instead of showing 0 synced senators.
    """
    response = safe_get(http, SENATE_SENATORS_AJAX_URL)
    if response is None:
        return []
    try:
        soup = BeautifulSoup(response.text, "html.parser")
        rows = soup.find_all("tr")
        senators: list[SenatorRecord] = []
        for row in rows:
            cells = [cell.get_text(" ", strip=True) for cell in row.find_all(["td", "th"])]
            if len(cells) < 6 or cells[0].lower() == "name":
                continue
            anchor = row.find("a", href=True)
            name, party, province, nominated, retirement, appointed_by = cells[:6]
            if not name or not province:
                continue
            senators.append(
                SenatorRecord(
                    senator_id=stable_id(name),
                    name=name,
                    party=party_label(party),
                    province=province,
                    office_details=[{
                        "type": "senate-profile",
                        "nominatedDate": nominated,
                        "retirementDate": retirement,
                        "appointedOnAdviceOf": appointed_by,
                    }],
                    source_url=urljoin(SENATE_SENATORS_AJAX_URL, str(anchor["href"])) if anchor else SENATE_SENATORS_AJAX_URL,
                    photo_url=None,
                )
            )
        if senators:
            LOGGER.info("Fetched %s senators from official Senate AJAX endpoint", len(senators))
        else:
            LOGGER.warning("Official Senate endpoint returned no parseable senator rows; structure may have changed.")
        return senators
    except Exception as exc:  # noqa: BLE001
        LOGGER.error("Official Senate senator parse failed: %s", exc, exc_info=True)
        return []


def parse_money(value: str) -> float | None:
    cleaned = re.sub(r"[^0-9.\-]", "", value.replace(",", ""))
    if not cleaned or cleaned in {"-", "."}:
        return None
    try:
        return float(Decimal(cleaned))
    except (InvalidOperation, ValueError):
        return None


def first_money(values: Iterable[str]) -> float | None:
    for value in values:
        parsed = parse_money(value)
        if parsed is not None:
            return parsed
    return None


def infer_quarter(text: str, fallback_year: int | None = None) -> str:
    normalized = " ".join(text.split())
    year_match = re.search(r"20\d{2}", normalized)
    year = year_match.group(0) if year_match else str(fallback_year or datetime.now(timezone.utc).year)
    q_match = re.search(r"\bQ([1-4])\b", normalized, flags=re.IGNORECASE)
    if q_match:
        return f"Q{q_match.group(1)}-{year}"
    ranges = [("jan", "mar", "Q1"), ("apr", "jun", "Q2"), ("jul", "sep", "Q3"), ("oct", "dec", "Q4")]
    lower = normalized.lower()
    for start, end, quarter in ranges:
        if start in lower and end in lower:
            return f"{quarter}-{year}"
    return f"Unknown-{year}"


def disclosure_links(http: requests.Session) -> list[str]:
    response = safe_get(http, SENATE_DISCLOSURE_URL)
    if response is None:
        return []
    soup = BeautifulSoup(response.text, "html.parser")
    links: list[str] = []
    for anchor in soup.find_all("a", href=True):
        label = anchor.get_text(" ", strip=True).lower()
        href = str(anchor["href"])
        if any(token in label for token in ["csv", "senator", "expenditure", "expense", "quarterly"]):
            links.append(urljoin(SENATE_DISCLOSURE_URL, href))
        elif any(href.lower().endswith(ext) for ext in [".csv", ".html", ".htm"]):
            links.append(urljoin(SENATE_DISCLOSURE_URL, href))
    unique = list(dict.fromkeys(links))
    if not unique:
        LOGGER.warning("No disclosure links found on %s; HTML structure may have changed.", SENATE_DISCLOSURE_URL)
    return unique[:20]


def parse_expenses_from_html(html: str, source_url: str, senators_by_name: dict[str, SenatorRecord]) -> list[ExpenseRecord]:
    soup = BeautifulSoup(html, "html.parser")
    records: list[ExpenseRecord] = []
    for table in soup.find_all("table"):
        headers = [cell.get_text(" ", strip=True).lower() for cell in table.find_all("th")]
        if not headers:
            continue
        for row in table.find_all("tr"):
            cells = [cell.get_text(" ", strip=True) for cell in row.find_all(["td", "th"])]
            if len(cells) < 3:
                continue
            haystack = " | ".join(cells).lower()
            matched = next((senator for name, senator in senators_by_name.items() if name.lower() in haystack), None)
            amount = first_money(reversed(cells))
            if not matched or amount is None:
                continue
            category = next((cell for cell in cells if "expense" in cell.lower() or "travel" in cell.lower() or "hospitality" in cell.lower()), "Uncategorized")
            records.append(ExpenseRecord(matched.senator_id, matched.name, infer_quarter(source_url + " " + table.get_text(" ", strip=True)), amount, category, source_url, {"cells": cells}))
    return records


def parse_expenses_from_csv(text: str, source_url: str, senators_by_name: dict[str, SenatorRecord]) -> list[ExpenseRecord]:
    records: list[ExpenseRecord] = []
    for row in csv.DictReader(io.StringIO(text)):
        values = {str(k or "").strip(): str(v or "").strip() for k, v in row.items()}
        joined = " | ".join(values.values()).lower()
        matched = next((senator for name, senator in senators_by_name.items() if name.lower() in joined), None)
        amount = first_money(value for key, value in values.items() if "amount" in key.lower() or "$" in value)
        if not matched or amount is None:
            continue
        category = next((value for key, value in values.items() if "category" in key.lower() or "type" in key.lower()), "Uncategorized")
        quarter = next((infer_quarter(value) for key, value in values.items() if "quarter" in key.lower() or "period" in key.lower()), infer_quarter(source_url))
        records.append(ExpenseRecord(matched.senator_id, matched.name, quarter, amount, category, source_url, values))
    return records


def fetch_expense_records(http: requests.Session, senators: Iterable[SenatorRecord]) -> list[ExpenseRecord]:
    senators_by_name = {senator.name: senator for senator in senators}
    records: list[ExpenseRecord] = []
    for link in disclosure_links(http):
        response = safe_get(http, link)
        if response is None:
            continue
        try:
            content_type = response.headers.get("content-type", "").lower()
            if "csv" in content_type or link.lower().endswith(".csv"):
                parsed = parse_expenses_from_csv(response.text, link, senators_by_name)
            else:
                parsed = parse_expenses_from_html(response.text, link, senators_by_name)
            if not parsed:
                LOGGER.warning("No expense rows parsed from %s; structure may have changed.", link)
            records.extend(parsed)
        except Exception as exc:  # noqa: BLE001 - ingestion should log and continue
            LOGGER.error("Expense parse failed for %s: %s", link, exc, exc_info=True)
    LOGGER.info("Parsed %s expense records", len(records))
    return records


def firestore_client() -> Any:
    if firebase_admin is None:
        raise RuntimeError("firebase-admin is not installed. Install scripts/requirements-senstats.txt")
    if not firebase_admin._apps:
        raw_json = os.getenv("GOOGLE_APPLICATION_CREDENTIALS_JSON") or os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON") or os.getenv("FIREBASE_SERVICE_ACCOUNT")
        if raw_json:
            info = json.loads(raw_json)
            firebase_admin.initialize_app(credentials.Certificate(info))
        else:
            firebase_admin.initialize_app()
    return firestore.client()


def write_senators(db: Any, senators: Iterable[SenatorRecord]) -> None:
    batch = db.batch()
    count = 0
    now = firestore.SERVER_TIMESTAMP
    for senator in senators:
        ref = db.collection("senstats_senators").document(senator.senator_id)
        batch.set(ref, {
            "id": senator.senator_id,
            "name": senator.name,
            "party": senator.party,
            "province": senator.province,
            "officeDetails": senator.office_details,
            "sourceUrl": senator.source_url,
            "photoUrl": senator.photo_url,
            "updatedAt": now,
        }, merge=True)
        count += 1
        if count % 450 == 0:
            batch.commit()
            batch = db.batch()
    if count % 450:
        batch.commit()
    LOGGER.info("Wrote %s senator documents", count)


def expense_doc_id(expense: ExpenseRecord) -> str:
    raw = f"{expense.senator_id}|{expense.quarter}|{expense.category}|{expense.amount}|{expense.source_url}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def write_expenses(db: Any, expenses: Iterable[ExpenseRecord]) -> None:
    batch = db.batch()
    count = 0
    now = firestore.SERVER_TIMESTAMP
    for expense in expenses:
        ref = db.collection("senstats_senators").document(expense.senator_id).collection("expenses").document(expense_doc_id(expense))
        batch.set(ref, {
            "quarter": expense.quarter,
            "amount": expense.amount,
            "category": expense.category,
            "sourceUrl": expense.source_url,
            "raw": expense.raw,
            "createdAt": now,
        }, merge=True)
        count += 1
        if count % 450 == 0:
            batch.commit()
            batch = db.batch()
    if count % 450:
        batch.commit()
    LOGGER.info("Wrote %s expense documents", count)


def main() -> int:
    http = session()
    senators = fetch_current_senators(http)
    if not senators:
        LOGGER.error("Aborting Firestore writes because senator metadata is empty.")
        return 0
    expenses = fetch_expense_records(http, senators)
    try:
        db = firestore_client()
        write_senators(db, senators)
        write_expenses(db, expenses)
    except Exception as exc:  # noqa: BLE001
        LOGGER.error("Firestore write failed: %s", exc, exc_info=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
