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
SENATE_DISCLOSURE_URL = "https://sencanada.ca/en/ProActive/Summary"
SENATE_DISCLOSURE_DETAILS_URL = "https://sencanada.ca/en/ProActive/Summary/Details"
SENATE_DISCLOSURE_SENATORS_URL = "https://sencanada.ca/en/ProActive/Summary/Senators"
SENATE_PROACTIVE_URL = "https://sencanada.ca/en/proactive/"
SENATE_SENATORS_AJAX_URL = "https://sencanada.ca/umbraco/surface/SenatorsAjax/GetSenators?Lang=en&displayFor=senatorslist"
SENATE_COMMITTEES_URL = "https://sencanada.ca/en/committees/"
DEFAULT_USER_AGENT = "Mozilla/5.0 (compatible; SenStats-Data-Sync/1.0; +https://flexspace-1.web.app; Contact: configure-SENSTATS_CONTACT_EMAIL)"
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
    user_agent = os.getenv("SENSTATS_USER_AGENT", f"Mozilla/5.0 (compatible; SenStats-Data-Sync/1.0; +https://flexspace-1.web.app; Contact: {contact_email})")
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


def fetch_current_senators(http: requests.Session) -> list[SenatorRecord]:
    """Fetch current senators from the official directory in one request.

    The Senate directory endpoint is the same XHR-backed table used by the
    public senators directory. Parsing this single response avoids the previous
    timeout-prone behavior of opening every individual senator profile page.
    """
    return fetch_senate_website_senators(http)


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
            source_url = SENATE_SENATORS_AJAX_URL
            profile_url = urljoin("https://sencanada.ca", str(anchor["href"])) if anchor else ""
            row_photo_url = extract_image_url(row, "https://sencanada.ca")
            profile_details: dict[str, Any] = {"profileUrl": profile_url} if profile_url else {}
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
                    photo_url=row_photo_url if is_probably_image_url(row_photo_url) else None,
                    contact_details=[],
                    extra_details={"nominatedDate": nominated, "retirementDate": retirement, "appointedOnAdviceOf": appointed_by},
                    profile_details=firestore_safe(profile_details),
                    raw_data=firestore_safe({"cells": cells, "rowAttributes": dict(row.attrs), "profileUrl": profile_url}),
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


DISCLOSURE_SUMMARY_URLS = [
    SENATE_DISCLOSURE_URL,
    SENATE_DISCLOSURE_SENATORS_URL,
    SENATE_DISCLOSURE_DETAILS_URL,
]


def disclosure_summary_pages() -> list[str]:
    """Return only top-level proactive disclosure summary pages.

    Expense ingestion intentionally does not crawl detail pages or nested
    disclosure links. The summary pages contain the primary static tables we
    need and are much less likely to trigger connection timeouts.
    """
    return DISCLOSURE_SUMMARY_URLS

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
    for link in disclosure_summary_pages():
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




def existing_senator_snapshot(db: Any) -> dict[str, dict[str, Any]]:
    """Read the previous senator roster for sync status and change detection."""
    try:
        return {doc.id: firestore_safe(doc.to_dict() or {}) for doc in db.collection("senstats_senators").stream()}
    except Exception as exc:  # noqa: BLE001
        LOGGER.error("Unable to read existing senator roster for change detection: %s", exc, exc_info=True)
        return {}


def detect_roster_changes(existing: dict[str, dict[str, Any]], senators: Iterable[SenatorRecord], sync_id: str) -> list[dict[str, Any]]:
    current = {senator.senator_id: senator for senator in senators}
    changes: list[dict[str, Any]] = []
    for senator_id, senator in current.items():
        previous = existing.get(senator_id)
        if previous is None:
            changes.append({
                "type": "new_senator",
                "senatorId": senator_id,
                "senatorName": senator.name,
                "newParty": senator.party,
                "newProvince": senator.province,
                "sourceUrl": senator.source_url,
                "syncId": sync_id,
            })
            continue
        previous_party = str(previous.get("party") or "")
        if previous_party and previous_party != senator.party:
            changes.append({
                "type": "group_change",
                "senatorId": senator_id,
                "senatorName": senator.name,
                "previousParty": previous_party,
                "newParty": senator.party,
                "previousProvince": str(previous.get("province") or ""),
                "newProvince": senator.province,
                "sourceUrl": senator.source_url,
                "syncId": sync_id,
            })
    for senator_id, previous in existing.items():
        if senator_id not in current:
            changes.append({
                "type": "retired_senator",
                "senatorId": senator_id,
                "senatorName": str(previous.get("name") or senator_id),
                "previousParty": str(previous.get("party") or ""),
                "previousProvince": str(previous.get("province") or ""),
                "sourceUrl": str(previous.get("sourceUrl") or ""),
                "syncId": sync_id,
            })
    return changes


def write_change_log(db: Any, changes: Iterable[dict[str, Any]]) -> int:
    batch = db.batch()
    count = 0
    now = firestore.SERVER_TIMESTAMP
    for change in changes:
        raw = f"{change.get('syncId')}|{change.get('type')}|{change.get('senatorId')}|{change.get('previousParty')}|{change.get('newParty')}"
        change_id = hashlib.sha1(raw.encode("utf-8")).hexdigest()
        ref = db.collection("senstats_change_log").document(change_id)
        batch.set(ref, {**firestore_safe(change), "detectedAt": now}, merge=True)
        count += 1
        if count % 450 == 0:
            batch.commit()
            batch = db.batch()
    if count % 450:
        batch.commit()
    LOGGER.info("Wrote %s SenStats change log records", count)
    return count


def write_sync_status(db: Any, *, sync_id: str, started_at: datetime, senators: list[SenatorRecord], expenses: list[ExpenseRecord], committees: list[CommitteeRecord], change_count: int, errors: list[str]) -> None:
    photo_count = sum(1 for senator in senators if senator.photo_url)
    status = "success" if not errors else "partial"
    payload = {
        "latestRunId": sync_id,
        "status": status,
        "startedAt": started_at,
        "finishedAt": firestore.SERVER_TIMESTAMP,
        "senatorCount": len(senators),
        "expenseCount": len(expenses),
        "committeeCount": len(committees),
        "changeCount": change_count,
        "errorCount": len(errors),
        "errors": errors[:20],
        "photoCount": photo_count,
        "missingPhotoCount": max(len(senators) - photo_count, 0),
        "workaround": "If live pages time out, manually export public Senate roster/proactive disclosure tables as CSV. If photos are missing or hotlink-blocked, run a separate low-frequency image mirror from official profile pages into a stable image store.",
    }
    db.collection("senstats_sync").document("latest").set(payload, merge=True)
    db.collection("senstats_sync_runs").document(sync_id).set(payload, merge=True)
    LOGGER.info("Wrote SenStats latest sync status for run %s", sync_id)

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
    started_at = datetime.now(timezone.utc)
    sync_id = started_at.strftime("%Y%m%dT%H%M%SZ")
    errors: list[str] = []
    http = session()
    senators = fetch_current_senators(http)
    if not senators:
        LOGGER.error("Aborting senator/expense/committee writes because senator metadata is empty.")
        try:
            db = firestore_client()
            write_sync_status(db, sync_id=sync_id, started_at=started_at, senators=[], expenses=[], committees=[], change_count=0, errors=["No senator metadata was parsed from the public Senate roster."])
        except Exception as exc:  # noqa: BLE001
            LOGGER.error("Failed to write empty-sync status: %s", exc, exc_info=True)
            return 1
        return 0
    expenses = fetch_expense_records(http, senators)
    committees = fetch_committee_records(http, senators)
    try:
        db = firestore_client()
        existing = existing_senator_snapshot(db)
        changes = detect_roster_changes(existing, senators, sync_id)
        write_party_affiliation_history(db, senators)
        write_senators(db, senators)
        write_expenses(db, expenses)
        write_committees(db, committees)
        change_count = write_change_log(db, changes)
        if not expenses:
            errors.append("No expense rows were parsed from the public proactive disclosure summary pages.")
        if not committees:
            errors.append("No committee rows were parsed from the public committees directory.")
        if not any(senator.photo_url for senator in senators):
            errors.append("The public roster response did not expose usable senator photo URLs.")
        write_sync_status(db, sync_id=sync_id, started_at=started_at, senators=senators, expenses=expenses, committees=committees, change_count=change_count, errors=errors)
    except Exception as exc:  # noqa: BLE001
        LOGGER.error("Firestore write failed: %s", exc, exc_info=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
