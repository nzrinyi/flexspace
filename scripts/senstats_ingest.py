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
import unicodedata
from dataclasses import dataclass, replace
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
SENATE_DISCLOSURE_URL = "https://sencanada.ca/en/ProActive/Summary"
SENATE_DISCLOSURE_DETAILS_URL = "https://sencanada.ca/en/ProActive/Summary/Details"
SENATE_DISCLOSURE_SENATORS_URL = "https://sencanada.ca/en/ProActive/Summary/Senators"
SENATE_PROACTIVE_URL = "https://sencanada.ca/en/proactive/"
SENATE_SENATORS_AJAX_URL = "https://sencanada.ca/umbraco/surface/SenatorsAjax/GetSenators?Lang=en&displayFor=senatorslist"
SENATE_COMMITTEES_URL = "https://sencanada.ca/en/committees/"
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
    contact_details: list[dict[str, Any]] | None = None
    extra_details: dict[str, Any] | None = None
    profile_details: dict[str, Any] | None = None
    raw_data: dict[str, Any] | None = None


@dataclass(frozen=True)
class ExpenseRecord:
    senator_id: str
    senator_name: str
    quarter: str
    amount: float
    category: str
    source_url: str
    raw: dict[str, Any]


@dataclass(frozen=True)
class CommitteeRecord:
    committee_id: str
    code: str
    name: str
    committee_type: str
    session: str
    source_url: str
    members: list[dict[str, str]]


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


def firestore_safe(value: Any) -> Any:
    """Convert scraper/API payloads into Firestore-safe primitive values."""
    if isinstance(value, dict):
        return {str(key): firestore_safe(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [firestore_safe(item) for item in value]
    if isinstance(value, tuple):
        return [firestore_safe(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def first_present(*values: Any) -> str | None:
    for value in values:
        if value:
            return str(value)
    return None


def is_probably_image_url(value: str | None) -> bool:
    if not value:
        return False
    lowered = value.lower().split("?", 1)[0]
    return any(token in lowered for token in ["/media/", "/images/", "/image/"]) or lowered.endswith((".jpg", ".jpeg", ".png", ".webp", ".gif"))


def extract_image_url(container: Any, base_url: str) -> str | None:
    if container is None:
        return None
    image = container.find("img") if hasattr(container, "find") else None
    if not image:
        return None
    for attr in ["src", "data-src", "data-original", "data-lazy-src"]:
        value = image.get(attr)
        if value:
            return urljoin(base_url, str(value))
    srcset = image.get("srcset")
    if srcset:
        first = str(srcset).split(",")[0].strip().split(" ")[0]
        if first:
            return urljoin(base_url, first)
    return None


def parse_profile_details(html: str, source_url: str) -> dict[str, Any]:
    """Extract best-effort public fields from a Senate profile page."""
    soup = BeautifulSoup(html, "html.parser")
    details: dict[str, Any] = {}
    heading = soup.find("h1")
    if heading:
        details["heading"] = heading.get_text(" ", strip=True)
    image_url = extract_image_url(soup, source_url)
    if image_url:
        details["photoUrl"] = image_url
    meta_description = soup.find("meta", attrs={"name": "description"})
    if meta_description and meta_description.get("content"):
        details["description"] = meta_description.get("content")
    og_image = soup.find("meta", property="og:image")
    if og_image and og_image.get("content"):
        details["photoUrl"] = urljoin(source_url, str(og_image.get("content")))
    for row in soup.select("dl, table"):
        for term in row.find_all(["dt", "th"]):
            label = term.get_text(" ", strip=True).strip(":")
            value_node = term.find_next_sibling(["dd", "td"])
            if label and value_node:
                details[stable_id(label)] = value_node.get_text(" ", strip=True)
    contact_links: list[dict[str, str]] = []
    for anchor in soup.find_all("a", href=True):
        href = str(anchor["href"])
        if href.startswith(("mailto:", "tel:")):
            contact_links.append({"label": anchor.get_text(" ", strip=True), "href": href})
    if contact_links:
        details["contactLinks"] = contact_links
    return details


def fetch_profile_details(http: requests.Session, source_url: str) -> dict[str, Any]:
    response = safe_get(http, source_url)
    if response is None:
        return {}
    try:
        return parse_profile_details(response.text, source_url)
    except Exception as exc:  # noqa: BLE001
        LOGGER.error("Senator profile parse failed for %s: %s", source_url, exc, exc_info=True)
        return {}


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
                raw_item = firestore_safe(item)
                offices = list(item.get("offices") or [])
                senators.append(
                    SenatorRecord(
                        senator_id=stable_id(name),
                        name=name,
                        party=str(item.get("party_name") or item.get("party") or "Independent/Unknown"),
                        province=str(item.get("district_name") or item.get("extra", {}).get("province") or item.get("province") or "Unknown"),
                        office_details=firestore_safe(offices),
                        source_url=str(item.get("source_url") or item.get("url") or REPRESENT_BASE_URL),
                        photo_url=first_present(item.get("photo_url"), item.get("image")),
                        contact_details=firestore_safe(offices),
                        extra_details=firestore_safe(item.get("extra") or {}),
                        raw_data=raw_item if isinstance(raw_item, dict) else {"value": raw_item},
                    )
                )
            meta = payload.get("meta") or {}
            next_path = meta.get("next")
            next_url = urljoin(REPRESENT_BASE_URL, next_path) if next_path else None
        if senators:
            LOGGER.info("Fetched %s senators from %s", len(senators), first_url)
            return enrich_with_senate_profiles(http, senators)
    LOGGER.warning("No senator metadata could be fetched from Represent endpoints; falling back to official Senate list.")
    return fetch_senate_website_senators(http)


def enrich_with_senate_profiles(http: requests.Session, senators: list[SenatorRecord]) -> list[SenatorRecord]:
    """Merge official Senate profile photos/details into API records when available."""
    senate_records = fetch_senate_website_senators(http)
    if not senate_records:
        return senators
    senate_by_id = {record.senator_id: record for record in senate_records}
    enriched: list[SenatorRecord] = []
    seen: set[str] = set()
    for senator in senators:
        official = senate_by_id.get(senator.senator_id)
        if official is None:
            enriched.append(senator)
            seen.add(senator.senator_id)
            continue
        seen.add(senator.senator_id)
        enriched.append(replace(
            senator,
            party=official.party or senator.party,
            province=official.province or senator.province,
            photo_url=senator.photo_url if is_probably_image_url(senator.photo_url) else official.photo_url or senator.photo_url,
            contact_details=senator.contact_details or official.contact_details,
            extra_details={**(official.extra_details or {}), **(senator.extra_details or {})},
            profile_details={**(official.profile_details or {}), **(senator.profile_details or {})},
            raw_data={"api": senator.raw_data or {}, "senate": official.raw_data or {}},
        ))
    for official in senate_records:
        if official.senator_id not in seen:
            enriched.append(official)
    LOGGER.info("Enriched %s senator records with official Senate profile data", len(enriched))
    return enriched


def party_label(value: str) -> str:
    labels = {
        "C": "CPC",
        "CSG": "CSG",
        "GRO": "GRO",
        "ISG": "ISG",
        "PSG": "PSG",
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
            source_url = urljoin("https://sencanada.ca", str(anchor["href"])) if anchor else SENATE_SENATORS_AJAX_URL
            row_photo_url = extract_image_url(row, "https://sencanada.ca")
            profile_details = fetch_profile_details(http, source_url) if anchor else {}
            profile_photo_url = profile_details.get("photoUrl") if isinstance(profile_details.get("photoUrl"), str) else None
            office_details = {
                "type": "senate-profile",
                "nominatedDate": nominated,
                "retirementDate": retirement,
                "appointedOnAdviceOf": appointed_by,
            }
            senators.append(
                SenatorRecord(
                    senator_id=stable_id(name),
                    name=name,
                    party=party_label(party),
                    province=province,
                    office_details=[office_details],
                    source_url=source_url,
                    photo_url=profile_photo_url or row_photo_url,
                    contact_details=firestore_safe(profile_details.get("contactLinks", [])),
                    extra_details={"nominatedDate": nominated, "retirementDate": retirement, "appointedOnAdviceOf": appointed_by},
                    profile_details=firestore_safe(profile_details),
                    raw_data=firestore_safe({"cells": cells, "rowAttributes": dict(row.attrs), "profileDetails": profile_details}),
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


def normalize_text(value: str) -> str:
    without_accents = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", " ", without_accents.lower()).strip()


def senator_name_aliases(name: str) -> set[str]:
    normalized = normalize_text(name)
    parts = normalized.split()
    aliases = {normalized}
    if len(parts) >= 2:
        aliases.add(" ".join([parts[-1], *parts[:-1]]))
        aliases.add(f"{parts[-1]} {' '.join(parts[:-1])}")
    return {alias for alias in aliases if alias}


def match_senator_from_text(text: str, senators_by_name: dict[str, SenatorRecord]) -> SenatorRecord | None:
    normalized = normalize_text(text)
    for name, senator in senators_by_name.items():
        if any(alias in normalized for alias in senator_name_aliases(name)):
            return senator
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
    links: list[str] = []
    for index_url in [SENATE_DISCLOSURE_URL, SENATE_DISCLOSURE_SENATORS_URL, SENATE_DISCLOSURE_DETAILS_URL, SENATE_PROACTIVE_URL]:
        response = safe_get(http, index_url)
        if response is None:
            continue
        soup = BeautifulSoup(response.text, "html.parser")
        links.append(index_url)
        for anchor in soup.find_all("a", href=True):
            label = anchor.get_text(" ", strip=True).lower()
            href = str(anchor["href"])
            absolute = urljoin(index_url, href)
            lower_href = absolute.lower()
            if any(token in label for token in ["csv", "senator", "expenditure", "expense", "quarterly", "office", "travel", "hospitality"]):
                links.append(absolute)
            elif "/proactive" in lower_href or any(lower_href.endswith(ext) for ext in [".csv", ".html", ".htm", ".xlsx", ".xls"]):
                links.append(absolute)
        for script in soup.find_all("script"):
            script_text = script.get_text(" ", strip=True)
            for match in re.finditer(r"(?:https?://sencanada\.ca)?/en/ProActive/[^\"\'\s<>]+", script_text, flags=re.IGNORECASE):
                links.append(urljoin(index_url, match.group(0)))
            for match in re.finditer(r"[^\"\'\s<>]+\.(?:csv|xlsx?|html?)", script_text, flags=re.IGNORECASE):
                links.append(urljoin(index_url, match.group(0)))
    unique = list(dict.fromkeys(links))
    if not unique:
        LOGGER.warning("No disclosure links found on Senate proactive disclosure pages; HTML structure may have changed.")
    return unique[:60]


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
            row_values = dict(zip(headers, cells, strict=False))
            haystack = " | ".join(cells)
            matched = match_senator_from_text(haystack, senators_by_name)
            amount = first_money(reversed(cells))
            if not matched or amount is None:
                continue
            category = next((cell for cell in cells + headers if "office" in cell.lower() or "travel" in cell.lower() or "hospitality" in cell.lower() or "living" in cell.lower() or "contract" in cell.lower()), "Uncategorized")
            records.append(ExpenseRecord(matched.senator_id, matched.name, infer_quarter(source_url + " " + table.get_text(" ", strip=True)), amount, category, source_url, {"cells": cells, "row": row_values}))
    return records



def parse_expenses_from_embedded_json(html: str, source_url: str, senators_by_name: dict[str, SenatorRecord]) -> list[ExpenseRecord]:
    soup = BeautifulSoup(html, "html.parser")
    records: list[ExpenseRecord] = []

    def walk(value: Any) -> Iterable[Any]:
        if isinstance(value, dict):
            yield value
            for child in value.values():
                yield from walk(child)
        elif isinstance(value, list):
            for child in value:
                yield from walk(child)

    for script in soup.find_all("script"):
        text = script.string or script.get_text(" ", strip=True)
        if not text or not any(token in text.lower() for token in ["amount", "expense", "hospitality", "travel", "senator"]):
            continue
        candidates = [text]
        for match in re.finditer(r"(\{.*\}|\[.*\])", text, flags=re.DOTALL):
            candidates.append(match.group(1))
        for candidate in candidates:
            try:
                payload = json.loads(candidate)
            except json.JSONDecodeError:
                continue
            for item in walk(payload):
                values = {str(key): firestore_safe(val) for key, val in item.items()}
                joined = " | ".join(str(val) for val in values.values())
                matched = match_senator_from_text(joined, senators_by_name)
                amount = first_money(str(val) for key, val in values.items() if "amount" in key.lower() or "total" in key.lower() or "$" in str(val))
                if not matched or amount is None:
                    continue
                category = next((str(val) for key, val in values.items() if any(token in key.lower() for token in ["category", "type", "expense"])), "Uncategorized")
                quarter = next((infer_quarter(str(val)) for key, val in values.items() if any(token in key.lower() for token in ["quarter", "period", "date", "fiscal"])), infer_quarter(source_url))
                records.append(ExpenseRecord(matched.senator_id, matched.name, quarter, amount, category, source_url, values))
    return records

def parse_expenses_from_csv(text: str, source_url: str, senators_by_name: dict[str, SenatorRecord]) -> list[ExpenseRecord]:
    records: list[ExpenseRecord] = []
    for row in csv.DictReader(io.StringIO(text)):
        values = {str(k or "").strip(): str(v or "").strip() for k, v in row.items()}
        joined = " | ".join(values.values())
        matched = match_senator_from_text(joined, senators_by_name)
        amount = first_money(value for key, value in values.items() if "amount" in key.lower() or "$" in value)
        if not matched or amount is None:
            continue
        category = next((value for key, value in values.items() if "category" in key.lower() or "type" in key.lower() or "expense" in key.lower()), "Uncategorized")
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
                parsed.extend(parse_expenses_from_embedded_json(response.text, link, senators_by_name))
            if not parsed:
                LOGGER.warning("No expense rows parsed from %s; structure may have changed.", link)
            records.extend(parsed)
        except Exception as exc:  # noqa: BLE001 - ingestion should log and continue
            LOGGER.error("Expense parse failed for %s: %s", link, exc, exc_info=True)
    LOGGER.info("Parsed %s expense records", len(records))
    return records


def committee_links(http: requests.Session) -> list[tuple[str, str]]:
    response = safe_get(http, SENATE_COMMITTEES_URL)
    links: dict[str, str] = {}
    if response is not None:
        soup = BeautifulSoup(response.text, "html.parser")
        for anchor in soup.find_all("a", href=True):
            href = str(anchor["href"])
            match = re.search(r"/en/committees/([a-z]{3,5})(?:/45-1)?/?", href, flags=re.IGNORECASE)
            if match:
                code = match.group(1).upper()
                links[code] = urljoin(SENATE_COMMITTEES_URL, f"/en/committees/{code.lower()}/45-1?v=committee-members")
    if links:
        return sorted(links.items())
    LOGGER.warning("Could not discover committee links; using known Senate committee code fallback.")
    fallback_codes = ["AEFA", "AGFO", "APPA", "AOVS", "BANC", "CIBA", "CONF", "ENEV", "FISH", "LCJC", "NFFN", "OLLO", "POFO", "RIDR", "RPRD", "SECD", "SELE", "SOCI", "TRCM"]
    return [(code, urljoin(SENATE_COMMITTEES_URL, f"/en/committees/{code.lower()}/45-1?v=committee-members")) for code in fallback_codes]


def parse_committee_page(html: str, source_url: str, code: str, senators_by_name: dict[str, SenatorRecord]) -> CommitteeRecord:
    soup = BeautifulSoup(html, "html.parser")
    heading = soup.find("h1")
    name = heading.get_text(" ", strip=True) if heading else code
    raw_text = soup.get_text("\n", strip=True)
    session_match = re.search(r"(\d{2}-\d).*?(\d{2}(?:st|nd|rd|th) Parliament, \d(?:st|nd|rd|th) Session.*?)\n", raw_text)
    session = " ".join(session_match.group(0).split()) if session_match else "45-1"
    committee_type = "Standing Committee" if "Standing" in raw_text[:500] else "Committee"
    members: list[dict[str, str]] = []
    seen: set[str] = set()
    for senator_name, senator in senators_by_name.items():
        if senator_name.lower() not in raw_text.lower():
            continue
        role = ""
        for line in raw_text.splitlines():
            if senator_name in line and any(token in line.lower() for token in ["chair", "deputy", "member", "ex officio"]):
                role = line.replace(senator_name, "").strip(" -·,;:")[:80]
                break
        key = senator.senator_id
        if key in seen:
            continue
        seen.add(key)
        members.append({"name": senator.name, "senatorId": senator.senator_id, "role": role, "party": senator.party, "province": senator.province})
    return CommitteeRecord(stable_id(code), code, name, committee_type, session, source_url, members)


def fetch_committee_records(http: requests.Session, senators: Iterable[SenatorRecord]) -> list[CommitteeRecord]:
    senators_by_name = {senator.name: senator for senator in senators}
    committees: list[CommitteeRecord] = []
    for code, url in committee_links(http):
        response = safe_get(http, url)
        if response is None:
            continue
        try:
            committees.append(parse_committee_page(response.text, url, code, senators_by_name))
        except Exception as exc:  # noqa: BLE001
            LOGGER.error("Committee parse failed for %s: %s", url, exc, exc_info=True)
    LOGGER.info("Parsed %s committee records", len(committees))
    return committees


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


def write_party_affiliation_history(db: Any, senators: Iterable[SenatorRecord]) -> None:
    count = 0
    for senator in senators:
        ref = db.collection("senstats_senators").document(senator.senator_id)
        existing = ref.get()
        previous_party = existing.to_dict().get("party") if existing.exists else None
        if previous_party and previous_party != senator.party:
            history_id = hashlib.sha1(f"{senator.senator_id}|{previous_party}|{senator.party}".encode("utf-8")).hexdigest()
            ref.collection("party_affiliation_history").document(history_id).set({
                "senatorId": senator.senator_id,
                "previousParty": previous_party,
                "newParty": senator.party,
                "sourceUrl": senator.source_url,
                "changedAt": firestore.SERVER_TIMESTAMP,
            }, merge=True)
            count += 1
    LOGGER.info("Wrote %s party affiliation history records", count)


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
            "officeDetails": firestore_safe(senator.office_details),
            "sourceUrl": senator.source_url,
            "photoUrl": senator.photo_url,
            "contactDetails": firestore_safe(senator.contact_details or []),
            "extraDetails": firestore_safe(senator.extra_details or {}),
            "profileDetails": firestore_safe(senator.profile_details or {}),
            "rawData": firestore_safe(senator.raw_data or {}),
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
            "senatorId": expense.senator_id,
            "senatorName": expense.senator_name,
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


def write_committees(db: Any, committees: Iterable[CommitteeRecord]) -> None:
    batch = db.batch()
    count = 0
    now = firestore.SERVER_TIMESTAMP
    for committee in committees:
        ref = db.collection("senstats_committees").document(committee.committee_id)
        batch.set(ref, {
            "id": committee.committee_id,
            "code": committee.code,
            "name": committee.name,
            "type": committee.committee_type,
            "session": committee.session,
            "sourceUrl": committee.source_url,
            "members": committee.members,
            "updatedAt": now,
        }, merge=True)
        count += 1
        if count % 450 == 0:
            batch.commit()
            batch = db.batch()
    if count % 450:
        batch.commit()
    LOGGER.info("Wrote %s committee documents", count)


def main() -> int:
    http = session()
    senators = fetch_current_senators(http)
    if not senators:
        LOGGER.error("Aborting Firestore writes because senator metadata is empty.")
        return 0
    expenses = fetch_expense_records(http, senators)
    committees = fetch_committee_records(http, senators)
    try:
        db = firestore_client()
        write_party_affiliation_history(db, senators)
        write_senators(db, senators)
        write_expenses(db, expenses)
        write_committees(db, committees)
    except Exception as exc:  # noqa: BLE001
        LOGGER.error("Firestore write failed: %s", exc, exc_info=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
