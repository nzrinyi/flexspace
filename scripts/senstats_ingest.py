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
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import parse_qs, urlencode, urljoin, urlparse

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
SENATE_PROACTIVE_URL = "https://sencanada.ca/en/proactive/"
SENATE_ATTENDANCE_URL = "https://sencanada.ca/en/attendance/"
SENATE_EXPENSE_SUMMARY_FILTER_URL = "https://sencanada.ca/en/proactive/summary/#?Year=2026&Quarter=1&Member=Senators"
SENATE_SENATORS_AJAX_URL = "https://sencanada.ca/umbraco/surface/SenatorsAjax/GetSenators?Lang=en&displayFor=senatorslist"
SENATE_SENATORS_TILES_AJAX_URL = "https://sencanada.ca/umbraco/surface/SenatorsAjax/GetSenators?Lang=en&displayFor=senatorstiles"
SENATE_COMMITTEES_URL = "https://sencanada.ca/en/committees/"
SENATE_COMMITTEE_LIST_AJAX_URL = "https://sencanada.ca/umbraco/surface/CommitteeAjax/GetCommitteeListPartialView?parlsession=&Lang=en"
SENATE_COMMITTEE_MEMBERSHIP_AJAX_URL = "https://sencanada.ca/umbraco/surface/CommitteeAjax/GetCommitteeMembership"

KNOWN_COMMITTEE_CODES = ["AEFA", "AGFO", "AOVS", "APPA", "BANC", "CIBA", "CONF", "ENEV", "LCJC", "NFFN", "OLLO", "POFO", "RIDR", "RPRD", "SECD", "SELE", "SOCI", "TRCM"]
KNOWN_COMMITTEE_IDS = {"AEFA": "1008"}
KNOWN_COMMITTEE_NAMES = {
    "AEFA": "Foreign Affairs and International Trade",
    "AGFO": "Agriculture and Forestry",
    "AOVS": "Audit and Oversight",
    "APPA": "Indigenous Peoples",
    "BANC": "Banking, Commerce and the Economy",
    "CIBA": "Internal Economy, Budgets and Administration",
    "CONF": "Ethics and Conflict of Interest for Senators",
    "ENEV": "Energy, the Environment and Natural Resources",
    "LCJC": "Legal and Constitutional Affairs",
    "NFFN": "National Finance",
    "OLLO": "Official Languages",
    "POFO": "Fisheries and Oceans",
    "RIDR": "Human Rights",
    "RPRD": "Rules, Procedures and the Rights of Parliament",
    "SECD": "National Security, Defence and Veterans Affairs",
    "SELE": "Selection Committee",
    "SOCI": "Social Affairs, Science and Technology",
    "TRCM": "Transport and Communications",
}
DEFAULT_USER_AGENT = "Mozilla/5.0 (compatible; SenStats-Data-Sync/1.0; +https://flexspace-1.web.app; Contact: configure-SENSTATS_CONTACT_EMAIL)"
LOG_PATH = os.getenv("SENSTATS_ERROR_LOG", "senstats_ingest_errors.log")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.StreamHandler(sys.stdout), logging.FileHandler(LOG_PATH, encoding="utf-8")],
)
LOGGER = logging.getLogger("senstats_ingest")
CONFIG_PATH = Path(__file__).with_name("config.json")


def load_config() -> dict[str, Any]:
    """Load public, non-secret ingestion settings from scripts/config.json."""
    if not CONFIG_PATH.exists():
        LOGGER.info("No %s file found; using built-in defaults and environment overrides.", CONFIG_PATH)
        return {}
    try:
        with CONFIG_PATH.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except json.JSONDecodeError as exc:
        LOGGER.error("Unable to parse %s: %s. Falling back to built-in defaults and environment overrides.", CONFIG_PATH, exc)
        return {}
    except OSError as exc:
        LOGGER.error("Unable to read %s: %s. Falling back to built-in defaults and environment overrides.", CONFIG_PATH, exc)
        return {}
    if not isinstance(data, dict):
        LOGGER.error("%s must contain a JSON object. Falling back to built-in defaults and environment overrides.", CONFIG_PATH)
        return {}
    return data


CONFIG = load_config()


def config_value(key: str, default: Any = None, env_name: str | None = None) -> Any:
    if env_name:
        env_value = os.getenv(env_name)
        if env_value not in (None, ""):
            return env_value
    return CONFIG.get(key, default)


def config_int(key: str, default: int, env_name: str | None = None) -> int:
    value = config_value(key, default, env_name)
    try:
        return int(value)
    except (TypeError, ValueError):
        LOGGER.warning("Invalid integer config for %s=%r; using %s", key, value, default)
        return default


def config_float(key: str, default: float, env_name: str | None = None) -> float:
    value = config_value(key, default, env_name)
    try:
        return float(value)
    except (TypeError, ValueError):
        LOGGER.warning("Invalid numeric config for %s=%r; using %s", key, value, default)
        return default


def config_bool(key: str, default: bool, env_name: str | None = None) -> bool:
    value = config_value(key, default, env_name)
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y", "on"}
    return bool(value)


def validate_config() -> None:
    if not str(config_value("proactive_xhr_url", "", "SENSTATS_PROACTIVE_XHR_URL") or "").strip():
        LOGGER.warning("No proactive_xhr_url configured; proactive expenses will use built-in XHR candidates.")
    committee_ids = config_value("committee_ids", {}, None)
    if not isinstance(committee_ids, (dict, list)) or not committee_ids:
        LOGGER.warning("No committee_ids configured; committee sync will fall back to discovery where possible.")


validate_config()


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


@dataclass(frozen=True)
class AttendanceRecord:
    senator_id: str
    senator_name: str
    party: str
    sitting_days: int
    present: int
    other_public_business: int
    illness: int
    leave: int
    session: str
    as_of: str
    source_url: str
    raw: dict[str, Any]


def polite_delay() -> None:
    """Randomized 2-5 second delay to avoid hammering public sites."""
    base_delay = config_float("request_delay_seconds", 2.0, "SENSTATS_REQUEST_DELAY_SECONDS")
    jitter = config_float("request_delay_jitter_seconds", 3.0, "SENSTATS_REQUEST_DELAY_JITTER_SECONDS")
    time.sleep(max(base_delay, 0) + random.uniform(0, max(jitter, 0)))


def session() -> requests.Session:
    contact_email = os.getenv("SENSTATS_CONTACT_EMAIL", "configure-SENSTATS_CONTACT_EMAIL")
    user_agent = config_value("user_agent", f"Mozilla/5.0 (compatible; SenStats-Data-Sync/1.0; +https://flexspace-1.web.app; Contact: {contact_email})", "SENSTATS_USER_AGENT")
    http = requests.Session()
    http.headers.update({"User-Agent": user_agent or DEFAULT_USER_AGENT, "Accept": "application/json,text/html,*/*", "X-Requested-With": "XMLHttpRequest"})
    return http


def safe_get(http: requests.Session, url: str, *, expect_json: bool = False, timeout: int | None = None, log_failures: bool = True, headers: dict[str, str] | None = None, retry_attempts: int | None = None) -> requests.Response | None:
    request_timeout = timeout or config_int("request_timeout", 20, "SENSTATS_REQUEST_TIMEOUT")
    max_attempts = max(retry_attempts if retry_attempts is not None else config_int("request_retry_attempts", 3, "SENSTATS_REQUEST_RETRY_ATTEMPTS"), 1)
    backoff_seconds = config_float("request_retry_backoff_seconds", 2.0, "SENSTATS_REQUEST_RETRY_BACKOFF_SECONDS")
    for attempt in range(1, max_attempts + 1):
        polite_delay()
        try:
            response = http.get(url, timeout=request_timeout, headers=headers)
            response.raise_for_status()
            if expect_json and "json" not in response.headers.get("content-type", ""):
                LOGGER.warning("Expected JSON but got %s from %s", response.headers.get("content-type"), url)
            return response
        except requests.HTTPError as exc:
            status_code = exc.response.status_code if exc.response is not None else 0
            retryable = status_code in {408, 429} or status_code >= 500
            if retryable and attempt < max_attempts:
                sleep_for = backoff_seconds * (2 ** (attempt - 1))
                if log_failures:
                    LOGGER.warning("Retrying %s after HTTP %s (%s/%s) in %.1fs", url, status_code, attempt + 1, max_attempts, sleep_for)
                time.sleep(sleep_for)
                continue
            if log_failures:
                LOGGER.warning("Skipping %s after HTTP %s", url, status_code or "unknown")
            return None
        except requests.Timeout as exc:
            if attempt < max_attempts:
                sleep_for = backoff_seconds * (2 ** (attempt - 1))
                if log_failures:
                    LOGGER.warning("Retrying %s after timeout (%s/%s) in %.1fs: %s", url, attempt + 1, max_attempts, sleep_for, exc)
                time.sleep(sleep_for)
                continue
            if log_failures:
                LOGGER.warning("Skipping %s after timeout: %s", url, exc)
            return None
        except requests.RequestException as exc:
            if attempt < max_attempts:
                sleep_for = backoff_seconds * (2 ** (attempt - 1))
                if log_failures:
                    LOGGER.warning("Retrying %s after request failure (%s/%s) in %.1fs: %s", url, attempt + 1, max_attempts, sleep_for, exc)
                time.sleep(sleep_for)
                continue
            if log_failures:
                LOGGER.warning("Skipping %s after request failure: %s", url, exc)
            return None
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


def clean_display_name(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("The Honourable", "").replace("Honourable", "")).strip(" ,")


def profile_url_key(value: str) -> str:
    return urljoin("https://sencanada.ca", value).split("?", 1)[0].rstrip("/").lower()


def fetch_senator_tile_photo_urls(http: requests.Session) -> dict[str, str]:
    """Read senator images from the official tile XHR endpoint."""
    response = safe_get(http, SENATE_SENATORS_TILES_AJAX_URL, timeout=config_int("senator_photo_timeout", 20, "SENSTATS_SENATOR_PHOTO_TIMEOUT"), log_failures=False)
    if response is None:
        return {}
    soup = BeautifulSoup(response.text, "html.parser")
    photos: dict[str, str] = {}
    for image in soup.find_all("img"):
        photo_url = extract_image_url(image.parent or image, "https://sencanada.ca")
        if not is_probably_image_url(photo_url):
            continue
        container = image.find_parent(["article", "li", "div"]) or image.parent
        anchor = container.find("a", href=True) if hasattr(container, "find") else None
        name = clean_display_name(str(image.get("alt") or "") or (anchor.get_text(" ", strip=True) if anchor else ""))
        if name:
            photos[stable_id(name)] = photo_url
        if anchor and anchor.get("href"):
            photos[profile_url_key(str(anchor["href"]))] = photo_url
    LOGGER.info("Parsed %s senator photo URLs from official Senate tiles XHR", len(photos))
    return photos


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


def party_compare_key(value: Any) -> str:
    """Normalize party labels before comparing stored and freshly parsed values."""
    label = party_label(str(value or ""))
    return re.sub(r"[^a-z0-9]+", "", label.lower())


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
        tile_photo_urls = fetch_senator_tile_photo_urls(http)
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
            photo_url = row_photo_url if is_probably_image_url(row_photo_url) else tile_photo_urls.get(profile_url_key(profile_url), tile_photo_urls.get(stable_id(name)))
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
                    photo_url=photo_url,
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


def disclosure_summary_pages() -> list[str]:
    """Return proactive disclosure pages with query parameters server-side.

    The public page uses hash fragments in the browser, but fragments are not
    sent over HTTP. These query-form URLs give the server a chance to render
    quarter/member-filtered tables while avoiding the removed Summary/Senators
    path that now returns 404.
    """
    current_year = datetime.now(timezone.utc).year
    years = [current_year, current_year - 1]
    urls: list[str] = []
    for year in years:
        for quarter in range(1, 5):
            query = f"?Year={year}&Quarter={quarter}&Member=Senators"
            urls.append(f"{SENATE_DISCLOSURE_URL}{query}")
            urls.append(f"{SENATE_DISCLOSURE_DETAILS_URL}{query}")
    urls.extend([SENATE_DISCLOSURE_URL, SENATE_DISCLOSURE_DETAILS_URL])
    return list(dict.fromkeys(urls))



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




def proactive_data_urls(year: int, quarter: int, display_for: str = "Summary") -> list[str]:
    """Return the browser XHR endpoint URLs used by the Senate proactive page.

    The proactive disclosure page is hash-routed in the browser, so fetching
    `/en/proactive/summary/?Year=...` directly often returns only the shell.
    The browser Network tab shows a `GetProActiveData` XHR that returns the
    rendered table partial. The current public endpoint is the
    `ProActiveAjax/GetProActiveData` surface with Year/Quarter/Member filters;
    older route/hash variants remain as fallbacks. Operators can override this
    with `SENSTATS_PROACTIVE_XHR_URL` and may use `{year}` / `{quarter}` placeholders.
    """
    configured = str(config_value("proactive_xhr_url", "", "SENSTATS_PROACTIVE_XHR_URL") or "").strip()
    if configured:
        return [
            item.strip().format(year=year, quarter=quarter, display_for=display_for)
            for item in configured.split(",")
            if item.strip()
        ]

    route_path = "/en/proactive/summary/"
    hash_path = f"/en/proactive/summary/#?Year={year}&Quarter={quarter}&Member=Senators"
    page_url = "https://sencanada.ca/en/proactive/summary/"
    ajax_query = urlencode({
        "displayFor": display_for,
        "isHashRouted": "true",
        "Year": year,
        "Quarter": quarter,
        "Member": "Senators",
        "pageUrl": page_url,
        "root": "undefined",
        "Lang": "en",
    })
    route_query = urlencode({"displayFor": display_for, "isHashRouted": "true", "url": route_path, "root": "undefined", "Lang": "en"})
    hash_query = urlencode({"displayFor": display_for, "isHashRouted": "true", "url": hash_path, "root": "undefined", "Lang": "en"})
    endpoint_paths = [
        # This is the current browser Network/XHR endpoint shape for the public page.
        f"/umbraco/surface/ProActiveAjax/GetProActiveData?{ajax_query}",
    ]
    if config_bool("proactive_route_fallbacks", False, "SENSTATS_PROACTIVE_ROUTE_FALLBACKS"):
        endpoint_paths.extend([
            # Older/alternate route shapes kept as opt-in fallbacks.
            f"/en/ProActive/Summary/GetProActiveData?{route_query}",
            f"/en/proactive/summary/GetProActiveData?{route_query}",
            f"/umbraco/Surface/ProActiveSurface/GetProActiveData?{route_query}",
            f"/umbraco/Surface/ProActiveDisclosureSurface/GetProActiveData?{route_query}",
            f"/umbraco/Surface/ProActiveDisclosure/GetProActiveData?{route_query}",
            f"/umbraco/Surface/ProActive/GetProActiveData?{route_query}",
            f"/en/ProActive/Summary/GetProActiveData?{hash_query}",
            f"/en/proactive/summary/GetProActiveData?{hash_query}",
        ])
    return list(dict.fromkeys(f"https://sencanada.ca{path}" for path in endpoint_paths))


def proactive_api_candidates(year: int, quarter: int) -> list[str]:
    query = f"Year={year}&Quarter={quarter}&Member=Senators"
    lower_query = f"year={year}&quarter={quarter}&member=Senators"
    return [
        f"https://sencanada.ca/api/proactive/summary?{query}",
        f"https://sencanada.ca/api/proactive/summary/details?{query}",
        f"https://sencanada.ca/umbraco/api/ProactiveDisclosureApi/GetSummary?{query}",
        f"https://sencanada.ca/umbraco/api/ProactiveDisclosureApi/GetDetails?{query}",
        f"https://sencanada.ca/umbraco/surface/ProactiveDisclosure/GetSummary?{query}",
        f"https://sencanada.ca/umbraco/surface/ProactiveDisclosure/GetDetails?{query}",
        f"https://sencanada.ca/umbraco/surface/ProactiveDisclosureSurface/GetSummary?{lower_query}",
        f"https://sencanada.ca/umbraco/surface/ProactiveDisclosureSurface/GetDetails?{lower_query}",
    ]


def parse_expenses_from_json_payload(payload: Any, source_url: str, senators_by_name: dict[str, SenatorRecord]) -> list[ExpenseRecord]:
    records: list[ExpenseRecord] = []

    def walk(value: Any) -> Iterable[dict[str, Any]]:
        if isinstance(value, dict):
            yield value
            for child in value.values():
                yield from walk(child)
        elif isinstance(value, list):
            for child in value:
                yield from walk(child)

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


def expense_periods() -> list[tuple[int, int]]:
    """Return every proactive-disclosure quarter from Q3 2016 to now."""
    current = datetime.now(timezone.utc)
    current_quarter = ((current.month - 1) // 3) + 1
    periods: list[tuple[int, int]] = []
    for year in range(2016, current.year + 1):
        first_quarter = 3 if year == 2016 else 1
        last_quarter = current_quarter if year == current.year else 4
        for quarter in range(first_quarter, last_quarter + 1):
            periods.append((year, quarter))
    return periods


def fetch_expenses_from_candidate_apis(http: requests.Session, senators_by_name: dict[str, SenatorRecord]) -> list[ExpenseRecord]:
    periods = expense_periods()
    records: list[ExpenseRecord] = []
    attempted_urls: set[str] = set()
    max_attempts = config_int("max_proactive_xhr_attempts", 80, "SENSTATS_MAX_PROACTIVE_XHR_ATTEMPTS")
    timeout_seconds = config_int("proactive_timeout", 10, "SENSTATS_PROACTIVE_TIMEOUT")
    LOGGER.info("Checking Senate proactive disclosure GetProActiveData XHR candidates for %s quarters back to Q3 2016 (max %s attempts)", len(periods), max_attempts)
    for year, quarter in periods:
        quarter_records: list[ExpenseRecord] = []
        for url in proactive_data_urls(year, quarter):
            if url in attempted_urls:
                continue
            if len(attempted_urls) >= max_attempts:
                LOGGER.info("Stopped proactive XHR probing after %s attempts; set SENSTATS_MAX_PROACTIVE_XHR_ATTEMPTS to raise this limit.", max_attempts)
                break
            attempted_urls.add(url)
            response = safe_get(
                http,
                url,
                timeout=timeout_seconds,
                log_failures=False,
                headers={"Referer": f"{SENATE_DISCLOSURE_URL}/#?Year={year}&Quarter={quarter}&Member=Senators"},
            )
            if response is None:
                continue
            content_type = response.headers.get("content-type", "").lower()
            try:
                if "json" in content_type:
                    parsed = parse_expenses_from_json_payload(response.json(), url, senators_by_name)
                else:
                    parsed = parse_expenses_from_html(response.text, url, senators_by_name)
                    parsed.extend(parse_expenses_from_embedded_json(response.text, url, senators_by_name))
            except Exception as exc:  # noqa: BLE001 - endpoint shape is external and may change
                LOGGER.warning("Expense XHR parse failed for %s: %s", url, exc)
                continue
            if parsed:
                LOGGER.info("Parsed %s expense rows from proactive disclosure XHR %s", len(parsed), url)
                quarter_records.extend(parsed)
                break
        if len(attempted_urls) >= max_attempts and not quarter_records:
            break
        if not quarter_records and config_bool("probe_proactive_apis", False, "SENSTATS_PROBE_PROACTIVE_APIS"):
            for url in proactive_api_candidates(year, quarter):
                response = safe_get(http, url, expect_json=True, timeout=8, log_failures=False)
                if response is None:
                    continue
                try:
                    parsed = parse_expenses_from_json_payload(response.json(), url, senators_by_name)
                except json.JSONDecodeError:
                    parsed = parse_expenses_from_html(response.text, url, senators_by_name)
                if parsed:
                    LOGGER.info("Parsed %s expense rows from proactive disclosure API candidate %s", len(parsed), url)
                    quarter_records.extend(parsed)
                    break
        records.extend(quarter_records)
    if not records and not config_bool("probe_proactive_apis", False, "SENSTATS_PROBE_PROACTIVE_APIS"):
        LOGGER.info("No expenses parsed from captured GetProActiveData XHR endpoints. If the public page still shows expenses, set SENSTATS_PROACTIVE_XHR_URL to the full copied request URL; optional legacy API probing remains disabled unless SENSTATS_PROBE_PROACTIVE_APIS=true.")
    return records

def fetch_expense_records(http: requests.Session, senators: Iterable[SenatorRecord]) -> list[ExpenseRecord]:
    senators_by_name = {senator.name: senator for senator in senators}
    records = fetch_expenses_from_candidate_apis(http, senators_by_name)
    check_static_pages = config_bool("check_static_pages", False, "SENSTATS_CHECK_STATIC_PROACTIVE_PAGES")
    if not records and check_static_pages:
        LOGGER.info("Checking %s proactive disclosure summary/detail pages for static expense rows", len(disclosure_summary_pages()))
        for link in disclosure_summary_pages():
            response = safe_get(http, link, timeout=config_int("static_proactive_timeout", 8, "SENSTATS_STATIC_PROACTIVE_TIMEOUT"), log_failures=False)
            if response is None:
                continue
            try:
                content_type = response.headers.get("content-type", "").lower()
                if "csv" in content_type or link.lower().endswith(".csv"):
                    parsed = parse_expenses_from_csv(response.text, link, senators_by_name)
                else:
                    parsed = parse_expenses_from_html(response.text, link, senators_by_name)
                    parsed.extend(parse_expenses_from_embedded_json(response.text, link, senators_by_name))
                records.extend(parsed)
            except Exception as exc:  # noqa: BLE001 - ingestion should log and continue
                LOGGER.warning("Expense parse failed for %s: %s", link, exc)
    elif not records:
        LOGGER.info("Skipping static proactive summary/detail page fallback because SENSTATS_CHECK_STATIC_PROACTIVE_PAGES is not true; those pages have recently returned shells without expense rows and can add several minutes of timeouts.")
    if not records:
        LOGGER.warning("No expense rows parsed from the captured GetProActiveData XHR endpoints. If this continues, set SENSTATS_PROACTIVE_XHR_URL to the full GetProActiveData request URL copied from the browser Network tab.")
    LOGGER.info("Parsed %s expense records", len(records))
    return records



def configured_committee_ids() -> dict[str, str]:
    ids = dict(KNOWN_COMMITTEE_IDS)
    configured = config_value("committee_ids", None, None)
    if isinstance(configured, dict):
        ids.update({str(code).upper(): str(value) for code, value in configured.items() if value})
    elif isinstance(configured, list):
        for code, value in zip(KNOWN_COMMITTEE_CODES, configured):
            if value:
                ids[code] = str(value)
    raw = os.getenv("SENSTATS_COMMITTEE_IDS", "")
    if not raw:
        return ids
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            ids.update({str(code).upper(): str(value) for code, value in parsed.items() if value})
            return ids
    except json.JSONDecodeError:
        pass
    for pair in raw.split(","):
        if "=" not in pair:
            continue
        code, value = pair.split("=", 1)
        if code.strip() and value.strip():
            ids[code.strip().upper()] = value.strip()
    return ids


def configured_committee_membership_urls() -> dict[str, str]:
    """Return optional full GetCommitteeMembership URLs keyed by committee code.

    This is intentionally forgiving so a copied Network-tab URL can be pasted
    directly into a GitHub Actions variable without needing a code change. Use
    either JSON (`{"AEFA": "https://..."}`) or comma-separated `CODE=https://...`
    pairs. URLs without a code in the pair are ignored because the membership
    endpoint only exposes CommitteeId/SessionId, not the acronym.
    """
    urls: dict[str, str] = {}
    configured = config_value("committee_membership_urls", None, None)
    if isinstance(configured, dict):
        urls.update({str(code).upper(): str(url) for code, url in configured.items() if code and url})
    raw = os.getenv("SENSTATS_COMMITTEE_MEMBERSHIP_URLS", "").strip()
    if not raw:
        return urls
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return {str(code).upper(): str(url) for code, url in parsed.items() if code and url}
    except json.JSONDecodeError:
        pass
    for pair in raw.split(","):
        if "=" not in pair:
            continue
        code, value = pair.split("=", 1)
        if code.strip() and value.strip():
            urls[code.strip().upper()] = value.strip()
    return urls


def has_explicit_committee_config() -> bool:
    configured_ids = config_value("committee_ids", None, None)
    configured_urls = config_value("committee_membership_urls", None, None)
    return bool(configured_ids or configured_urls or os.getenv("SENSTATS_COMMITTEE_IDS") or os.getenv("SENSTATS_COMMITTEE_MEMBERSHIP_URLS"))


def committee_id_from_membership_url(url: str) -> str:
    params = parse_qs(urlparse(url).query)
    values = params.get("CommitteeId") or params.get("committeeId")
    return values[0] if values else ""


def committee_id_from_markup(html: str, code: str) -> str | None:
    windows = [match.start() for match in re.finditer(re.escape(code), html, flags=re.IGNORECASE)]
    for start in windows:
        excerpt = html[max(0, start - 600):start + 1200]
        match = re.search(r"(?:CommitteeId|committeeId|data-committee-id)[\"'=\s:]+(\d+)", excerpt)
        if match:
            return match.group(1)
    return None


def with_cache_buster(url: str) -> str:
    if "_=" in url:
        return url
    separator = "&" if "?" in url else "?"
    return f"{url}{separator}_={int(time.time() * 1000)}"


def committee_request_headers(code: str) -> dict[str, str]:
    return {
        "Accept": "text/html,text/plain,*/*; q=0.01",
        "Referer": urljoin(SENATE_COMMITTEES_URL, f"/en/committees/{code.lower()}/"),
        "X-Requested-With": "XMLHttpRequest",
    }


def committee_source_mode() -> str:
    mode = str(config_value("committee_source_mode", "static", "SENSTATS_COMMITTEE_SOURCE_MODE") or "static").strip().lower()
    aliases = {
        "page": "static",
        "pages": "static",
        "static_only": "static",
        "xhr_only": "xhr",
        "ajax": "xhr",
        "static_first": "static_then_xhr",
    }
    mode = aliases.get(mode, mode)
    if mode not in {"static", "xhr", "static_then_xhr"}:
        LOGGER.warning("Unknown committee_source_mode=%r; using static pages only.", mode)
        return "static"
    return mode


def committee_membership_request_options(code: str, membership_url: str, page_url: str) -> list[tuple[str, dict[str, str] | None]]:
    membership_page = urljoin(SENATE_COMMITTEES_URL, f"/en/committees/{code.lower()}/45-1")
    mode = committee_source_mode()
    static_option = [(membership_page, None)]
    if mode == "static" or not membership_url:
        return static_option
    xhr_options: list[tuple[str, dict[str, str] | None]] = [
        (with_cache_buster(membership_url), committee_request_headers(code)),
        (membership_url, committee_request_headers(code)),
        (membership_url, None),
    ]
    if mode == "xhr":
        return xhr_options
    return static_option + xhr_options


def committee_links(http: requests.Session) -> list[dict[str, str]]:
    configured_ids = configured_committee_ids()
    configured_membership_urls = configured_committee_membership_urls()
    if has_explicit_committee_config():
        LOGGER.info("Using configured committee IDs/URLs; skipping committee link discovery.")
        configured_codes = sorted(set(configured_ids) | set(configured_membership_urls), key=lambda code: (KNOWN_COMMITTEE_CODES.index(code) if code in KNOWN_COMMITTEE_CODES else 999, code))
        return [{
            "code": code,
            "url": urljoin(SENATE_COMMITTEES_URL, f"/en/committees/{code.lower()}/45-1"),
            "committeeId": committee_id_from_membership_url(configured_membership_urls.get(code, "")) or configured_ids.get(code, ""),
            "membershipUrl": configured_membership_urls.get(code, ""),
        } for code in configured_codes]
    response = safe_get(http, SENATE_COMMITTEE_LIST_AJAX_URL, timeout=config_int("committee_list_timeout", 20, "SENSTATS_COMMITTEE_LIST_TIMEOUT"), log_failures=False)
    links: dict[str, dict[str, str]] = {}
    if response is not None:
        soup = BeautifulSoup(response.text, "html.parser")
        for anchor in soup.find_all("a", href=True):
            href = str(anchor["href"])
            match = re.search(r"/en/committees/([a-z]{3,5})(?:/45-1)?/?", href, flags=re.IGNORECASE)
            if match:
                code = match.group(1).upper()
                if code in KNOWN_COMMITTEE_CODES:
                    links[code] = {
                        "code": code,
                        "url": urljoin(SENATE_COMMITTEES_URL, f"/en/committees/{code.lower()}/45-1"),
                        "committeeId": committee_id_from_markup(response.text, code) or committee_id_from_membership_url(configured_membership_urls.get(code, "")) or configured_ids.get(code, ""),
                        "membershipUrl": configured_membership_urls.get(code, ""),
                    }
    if not links and not config_bool("skip_committee_directory_page", True, "SENSTATS_SKIP_COMMITTEE_DIRECTORY_PAGE"):
        response = safe_get(http, SENATE_COMMITTEES_URL)
        if response is not None:
            soup = BeautifulSoup(response.text, "html.parser")
            for anchor in soup.find_all("a", href=True):
                href = str(anchor["href"])
                match = re.search(r"/en/committees/([a-z]{3,5})(?:/45-1)?/?", href, flags=re.IGNORECASE)
                if match:
                    code = match.group(1).upper()
                    if code in KNOWN_COMMITTEE_CODES:
                        links[code] = {
                            "code": code,
                            "url": urljoin(SENATE_COMMITTEES_URL, f"/en/committees/{code.lower()}/45-1"),
                            "committeeId": committee_id_from_markup(response.text, code) or committee_id_from_membership_url(configured_membership_urls.get(code, "")) or configured_ids.get(code, ""),
                            "membershipUrl": configured_membership_urls.get(code, ""),
                        }
    if links:
        return [links[code] for code in sorted(links)]
    if config_bool("use_committee_fallback", True, "SENSTATS_USE_COMMITTEE_FALLBACK"):
        LOGGER.warning("Could not discover committee links; using known Senate committee code fallback.")
        return [{"code": code, "url": urljoin(SENATE_COMMITTEES_URL, f"/en/committees/{code.lower()}/45-1"), "committeeId": committee_id_from_membership_url(configured_membership_urls.get(code, "")) or configured_ids.get(code, ""), "membershipUrl": configured_membership_urls.get(code, "")} for code in KNOWN_COMMITTEE_CODES]
    LOGGER.warning("Could not discover committee links; skipping committee page fetches this run. Set SENSTATS_USE_COMMITTEE_FALLBACK=true to try known committee URLs.")
    return []


def parse_committee_page(html: str, source_url: str, code: str, senators_by_name: dict[str, SenatorRecord], senators_by_profile: dict[str, SenatorRecord]) -> CommitteeRecord:
    soup = BeautifulSoup(html, "html.parser")
    heading = soup.find("h1")
    name = heading.get_text(" ", strip=True) if heading else KNOWN_COMMITTEE_NAMES.get(code.upper(), code)
    raw_text = soup.get_text("\n", strip=True)
    session_match = re.search(r"(\d{2}-\d).*?(\d{2}(?:st|nd|rd|th) Parliament, \d(?:st|nd|rd|th) Session.*?)\n", raw_text)
    session = " ".join(session_match.group(0).split()) if session_match else "45-1"
    committee_type = "Standing Committee" if "Standing" in raw_text[:500] else "Committee"
    members: list[dict[str, str]] = []
    seen: set[str] = set()

    def append_member(name_text: str, role: str, party: str = "", province: str = "", profile_url: str = "") -> None:
        normalized_name = clean_display_name(name_text)
        senator = senators_by_profile.get(profile_url_key(profile_url)) if profile_url else None
        senator = senator or senators_by_name.get(normalized_name)
        key = senator.senator_id if senator else stable_id(normalized_name or profile_url)
        if not key or key in seen:
            return
        seen.add(key)
        members.append({
            "name": senator.name if senator else normalized_name,
            "senatorId": senator.senator_id if senator else key,
            "role": role,
            "party": senator.party if senator else party_label(party),
            "province": senator.province if senator else province,
        })

    for card in soup.select(".sc-committee-members-dynamic-content-member-card"):
        row = card.find_parent("div", class_="row")
        if row is None:
            continue
        anchors = row.find_all("a", href=True)
        anchor = next((candidate for candidate in anchors if candidate.get_text(" ", strip=True)), None)
        profile_anchor = anchor or (anchors[0] if anchors else None)
        role_heading = row.find(["h3", "h4"])
        detail_text = row.get_text(" ", strip=True)
        party = ""
        province = ""
        affiliation_match = re.search(r"\b(C|CPC|CSG|GRO|ISG|PSG|Non-affiliated)\b\s*-\s*\(([^)]+)\)", detail_text)
        if affiliation_match:
            party = affiliation_match.group(1)
            province = affiliation_match.group(2)
        append_member(anchor.get_text(" ", strip=True) if anchor else "", role_heading.get_text(" ", strip=True) if role_heading else "Member", party, province, str(profile_anchor["href"]) if profile_anchor else "")

    for senator_name, senator in senators_by_name.items():
        if senator.senator_id in seen or senator_name.lower() not in raw_text.lower():
            continue
        role = ""
        for line in raw_text.splitlines():
            if senator_name in line and any(token in line.lower() for token in ["chair", "deputy", "member", "ex officio"]):
                role = line.replace(senator_name, "").strip(" -·,;:")[:80]
                break
        append_member(senator.name, role or "Member", senator.party, senator.province, "")
    return CommitteeRecord(stable_id(code), code, name, committee_type, session, source_url, members)


def fetch_committee_records(http: requests.Session, senators: Iterable[SenatorRecord]) -> list[CommitteeRecord]:
    senators_by_name = {senator.name: senator for senator in senators}
    senators_by_profile = {profile_url_key(str((senator.profile_details or {}).get("profileUrl") or "")): senator for senator in senators if (senator.profile_details or {}).get("profileUrl")}
    committees: list[CommitteeRecord] = []
    committee_timeout = config_int("committee_timeout", 10, "SENSTATS_COMMITTEE_TIMEOUT")
    membership_timeout = config_int("committee_membership_timeout", max(committee_timeout, 30), "SENSTATS_COMMITTEE_MEMBERSHIP_TIMEOUT")
    membership_attempts = max(config_int("committee_membership_attempts", 3, "SENSTATS_COMMITTEE_MEMBERSHIP_ATTEMPTS"), 1)
    membership_retry_attempts = max(config_int("committee_request_retry_attempts", 1, "SENSTATS_COMMITTEE_REQUEST_RETRY_ATTEMPTS"), 1)
    session_id = str(config_value("committee_session_id", "32", "SENSTATS_COMMITTEE_SESSION_ID"))
    for link in committee_links(http):
        code = link["code"]
        url = link["url"]
        committee_id = link.get("committeeId", "")
        membership_url = link.get("membershipUrl", "") or (f"{SENATE_COMMITTEE_MEMBERSHIP_AJAX_URL}?{urlencode({'CommitteeId': committee_id, 'SessionId': session_id, 'Lang': 'en'})}" if committee_id else "")
        if not membership_url and config_bool("skip_committee_page_fallback", True, "SENSTATS_SKIP_COMMITTEE_PAGE_FALLBACK"):
            LOGGER.warning("Skipping committee %s because no CommitteeId was discovered; set SENSTATS_COMMITTEE_IDS or SENSTATS_COMMITTEE_MEMBERSHIP_URLS to include it.", code)
            continue
        response = None
        source_url = ""
        for option_index, (candidate_url, candidate_headers) in enumerate(committee_membership_request_options(code, membership_url, url), start=1):
            source_url = candidate_url
            is_xhr_candidate = "CommitteeAjax/GetCommitteeMembership" in candidate_url
            attempts = membership_attempts if is_xhr_candidate and option_index == 1 else 1
            timeout = membership_timeout if is_xhr_candidate else committee_timeout
            retry_attempts = membership_retry_attempts if is_xhr_candidate else 1
            for attempt in range(1, attempts + 1):
                response = safe_get(http, candidate_url, timeout=timeout, headers=candidate_headers, log_failures=attempt == attempts, retry_attempts=retry_attempts)
                if response is not None:
                    break
                if attempt < attempts:
                    LOGGER.warning("Retrying committee %s membership request (%s/%s)", code, attempt + 1, attempts)
            if response is not None:
                break
        if response is None:
            continue
        try:
            committee = parse_committee_page(response.text, source_url, code, senators_by_name, senators_by_profile)
            if not committee.members:
                LOGGER.warning("Committee %s parsed from %s but contained no member rows; please copy the Network-tab Response body for that GetCommitteeMembership request if this persists.", code, source_url)
            committees.append(committee)
        except Exception as exc:  # noqa: BLE001
            LOGGER.error("Committee parse failed for %s: %s", source_url, exc, exc_info=True)
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


def senators_from_snapshot(snapshot: dict[str, dict[str, Any]]) -> list[SenatorRecord]:
    """Build minimal senator records from the last successful Firestore roster.

    The Senate roster endpoint occasionally times out from GitHub-hosted runners.
    Committee and attendance parsing can still proceed safely with the previous
    roster because those writes are keyed separately and do not imply roster
    retirements or group changes.
    """
    senators: list[SenatorRecord] = []
    for senator_id, data in snapshot.items():
        name = str(data.get("name") or "").strip()
        if not name:
            continue
        senators.append(SenatorRecord(
            senator_id=senator_id,
            name=name,
            party=party_label(str(data.get("party") or "")),
            province=str(data.get("province") or "").strip(),
            gender=str(data.get("gender") or "").strip(),
            photo_url=str(data.get("photoUrl") or "").strip(),
            source_url=str(data.get("sourceUrl") or SENATE_SENATORS_AJAX_URL),
            profile_details=firestore_safe(data.get("profileDetails") or {}),
            raw_data=firestore_safe(data),
        ))
    LOGGER.info("Loaded %s senators from the previous Firestore snapshot for related-data parsing", len(senators))
    return senators


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
        previous_party = party_label(str(previous.get("party") or ""))
        if previous_party and party_compare_key(previous_party) != party_compare_key(senator.party):
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


def write_sync_status(db: Any, *, sync_id: str, started_at: datetime, senators: list[SenatorRecord], expenses: list[ExpenseRecord], committees: list[CommitteeRecord], attendance: list[AttendanceRecord], change_count: int, errors: list[str]) -> None:
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
        "attendanceCount": len(attendance),
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
        previous_party = party_label(str(existing.to_dict().get("party") or "")) if existing.exists else None
        if previous_party and party_compare_key(previous_party) != party_compare_key(senator.party):
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




def parse_int(value: str) -> int:
    parsed = re.sub(r"[^0-9]", "", value or "")
    return int(parsed) if parsed else 0


def parse_attendance_records(html: str, senators_by_name: dict[str, SenatorRecord]) -> list[AttendanceRecord]:
    soup = BeautifulSoup(html, "html.parser")
    page_text = soup.get_text(" ", strip=True)
    session_match = re.search(r"(\d{2}-\d).*?(\d{2}(?:st|nd|rd|th) Parliament, \d(?:st|nd|rd|th) Session)", page_text)
    session = " ".join(session_match.group(0).split()) if session_match else "Current session"
    as_of_match = re.search(r"Information as of\s+([A-Za-z]+\s+\d{4})", page_text)
    as_of = as_of_match.group(1) if as_of_match else ""
    records: list[AttendanceRecord] = []

    def append_record(cells: list[str]) -> None:
        if len(cells) < 7 or cells[0].lower() in {"name", "a", "b", "c", "d", "f", "g", "h", "i", "k", "l", "m", "o", "p", "q", "r", "s", "t", "v", "w", "y"}:
            return
        name, party = cells[0], cells[1]
        if not name or not any(char.isdigit() for char in " ".join(cells[2:])):
            return
        matched = match_senator_from_text(name, senators_by_name)
        senator_id = matched.senator_id if matched else stable_id(name)
        records.append(AttendanceRecord(
            senator_id=senator_id,
            senator_name=matched.name if matched else name,
            party=party_label(party),
            sitting_days=parse_int(cells[2]),
            present=parse_int(cells[3]),
            other_public_business=parse_int(cells[4]),
            illness=parse_int(cells[5]),
            leave=parse_int(cells[6]),
            session=session,
            as_of=as_of,
            source_url=SENATE_ATTENDANCE_URL,
            raw={"cells": cells},
        ))

    for table in soup.find_all("table"):
        for row in table.find_all("tr"):
            append_record([cell.get_text(" ", strip=True) for cell in row.find_all(["td", "th"])])

    if not records:
        party_pattern = r"(?:C|CPC|CSG|GRO|ISG|PSG|Non-affiliated)"
        line_pattern = re.compile(rf"^(.+?)\s+({party_pattern})\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$", re.IGNORECASE)
        for line in soup.get_text("\n", strip=True).splitlines():
            match = line_pattern.match(" ".join(line.split()))
            if match:
                append_record([match.group(1), match.group(2), match.group(3), match.group(4), match.group(5), match.group(6), match.group(7)])
    return records


def fetch_attendance_records(http: requests.Session, senators: Iterable[SenatorRecord]) -> list[AttendanceRecord]:
    senators_by_name = {senator.name: senator for senator in senators}
    response = safe_get(http, SENATE_ATTENDANCE_URL, timeout=config_int("attendance_timeout", 10, "SENSTATS_ATTENDANCE_TIMEOUT"))
    if response is None:
        return []
    try:
        records = parse_attendance_records(response.text, senators_by_name)
        LOGGER.info("Parsed %s attendance records", len(records))
        return records
    except Exception as exc:  # noqa: BLE001
        LOGGER.error("Attendance parse failed for %s: %s", SENATE_ATTENDANCE_URL, exc, exc_info=True)
        return []


def write_attendance(db: Any, attendance: Iterable[AttendanceRecord]) -> None:
    batch = db.batch()
    count = 0
    now = firestore.SERVER_TIMESTAMP
    for record in attendance:
        ref = db.collection("senstats_attendance").document(record.senator_id)
        batch.set(ref, {
            "senatorId": record.senator_id,
            "senatorName": record.senator_name,
            "party": record.party,
            "sittingDays": record.sitting_days,
            "present": record.present,
            "otherPublicBusiness": record.other_public_business,
            "illness": record.illness,
            "leave": record.leave,
            "session": record.session,
            "asOf": record.as_of,
            "sourceUrl": record.source_url,
            "raw": firestore_safe(record.raw),
            "updatedAt": now,
        }, merge=True)
        count += 1
        if count % 450 == 0:
            batch.commit()
            batch = db.batch()
    if count % 450:
        batch.commit()
    LOGGER.info("Wrote %s attendance documents", count)

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
    db: Any | None = None
    existing: dict[str, dict[str, Any]] = {}
    related_senators = senators
    if not senators:
        message = "No senator metadata was parsed from the public Senate roster; using the previous Firestore roster for committee/attendance parsing only."
        LOGGER.error(message)
        errors.append(message)
        try:
            db = firestore_client()
            existing = existing_senator_snapshot(db)
            related_senators = senators_from_snapshot(existing)
        except Exception as exc:  # noqa: BLE001
            LOGGER.error("Unable to load previous senator snapshot for related-data parsing: %s", exc, exc_info=True)
            related_senators = []
    attendance = fetch_attendance_records(http, related_senators)
    committees = fetch_committee_records(http, related_senators)
    expenses = fetch_expense_records(http, related_senators) if related_senators else []
    try:
        db = db or firestore_client()
        if senators:
            existing = existing_senator_snapshot(db)
            changes = detect_roster_changes(existing, senators, sync_id)
            write_party_affiliation_history(db, senators)
            write_senators(db, senators)
        else:
            changes = []
        write_expenses(db, expenses)
        write_committees(db, committees)
        write_attendance(db, attendance)
        change_count = write_change_log(db, changes)
        if not expenses:
            errors.append("No expense rows were parsed from the public proactive disclosure summary pages.")
        if not committees:
            errors.append("No committee rows were parsed from the public committees directory.")
        if not attendance:
            errors.append("No attendance rows were parsed from the public attendance register.")
        if not any(senator.photo_url for senator in senators):
            errors.append("The public roster response did not expose usable senator photo URLs.")
        write_sync_status(db, sync_id=sync_id, started_at=started_at, senators=senators, expenses=expenses, committees=committees, attendance=attendance, change_count=change_count, errors=errors)
    except Exception as exc:  # noqa: BLE001
        LOGGER.error("Firestore write failed: %s", exc, exc_info=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
