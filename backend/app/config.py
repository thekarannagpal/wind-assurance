"""Application settings, constants and timezone/data-convention notes."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

# All timestamps are UTC ("Z"). Great Britain is on GMT (UTC+0) in January,
# so a settlement day D runs in UTC from D 00:00 to D 23:30 (48 slots).
ELEXON_BASE_URL = os.environ.get("ELEXON_BASE_URL", "https://data.elexon.co.uk/bmrs/api/v1")

DATA_DIR = Path(os.environ.get("DATA_DIR", BASE_DIR.parent / "data")).resolve()
DB_PATH = DATA_DIR / "bmrs.sqlite3"

# Challenge scope: purchase decisions for delivery days in January 2026.
SCOPE_MONTH_START = "2026-01-01"
SCOPE_MONTH_END = "2026-01-31"

# Actuals must start on the last day of December so we can compute a
# day-ahead persistence benchmark for January 1st.
ACTUALS_DATE_FROM = "2025-12-31"
ACTUALS_DATE_TO = SCOPE_MONTH_END

# Forecast runs published in this window: cover day-ahead decisions for all of
# January (runs published 2025-12-30 onwards) plus the latest intraday
# revisions seen before each delivery day closes.
PUBLISH_WINDOW_FROM = "2025-12-30T00:00:00Z"
PUBLISH_WINDOW_TO = "2026-02-02T00:00:00Z"

# Default decision cut-off: UK day-ahead auction gate closure is 09:30 UK
# time (GMT in January) on the day before delivery. Users can override it
# per-request to explore "what did we know at time X?".
DEFAULT_CUTOFF = os.environ.get("DECISION_CUTOFF", "09:30:00")

INGEST_ON_START = os.environ.get("INGEST_ON_START", "1") == "1"

# CORS origins for local dev (vite) and the deployed frontend.
CORS_ORIGINS = os.environ.get(
    "CORS_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
).split(",")


def datetime_key(iso: str) -> str:
    """Normalise elexon timestamps ('...Z') to a sortable ISO string."""
    return iso.replace("Z", "+00:00") if iso.endswith("Z") else iso
