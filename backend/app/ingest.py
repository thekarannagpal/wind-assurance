"""SQLite storage layer and initial data ingestion from the Elexon API."""
from __future__ import annotations

import logging
import sqlite3
from datetime import UTC, datetime

from .config import (
    ACTUALS_DATE_FROM,
    ACTUALS_DATE_TO,
    DB_PATH,
    ELEXON_BASE_URL,
    PUBLISH_WINDOW_FROM,
    PUBLISH_WINDOW_TO,
    SCOPE_MONTH_END,
    SCOPE_MONTH_START,
)
from .elexon import ElexonClient

log = logging.getLogger("ingest")

SCHEMA = """
CREATE TABLE IF NOT EXISTS actuals (
    start_time TEXT PRIMARY KEY,
    generation REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS forecasts (
    publish_time TEXT NOT NULL,
    start_time TEXT NOT NULL,
    generation REAL NOT NULL,
    PRIMARY KEY (publish_time, start_time)
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS ix_forecasts_start ON forecasts(start_time, publish_time);
"""


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=30)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    return con


def is_populated(con: sqlite3.Connection) -> bool:
    (n,) = con.execute("SELECT COUNT(*) FROM actuals").fetchone()
    (m,) = con.execute("SELECT COUNT(*) FROM forecasts").fetchone()
    return n > 0 and m > 0


def in_scope_actuals(con: sqlite3.Connection) -> int:
    (a,) = con.execute(
        "SELECT COUNT(*) FROM actuals WHERE substr(start_time,1,10) BETWEEN ? AND ?",
        (SCOPE_MONTH_START, SCOPE_MONTH_END),
    ).fetchone()
    return a


def table_stats(con: sqlite3.Connection) -> dict:
    (n_actual,) = con.execute("SELECT COUNT(*) FROM actuals").fetchone()
    (n_fc,) = con.execute("SELECT COUNT(*) FROM forecasts").fetchone()
    (p_min,) = con.execute("SELECT MIN(publish_time) FROM forecasts").fetchone()
    (p_max,) = con.execute("SELECT MAX(publish_time) FROM forecasts").fetchone()
    row = con.execute("SELECT value FROM meta WHERE key='ingested_at'").fetchone()
    return {
        "actuals_rows": n_actual,
        "actuals_rows_in_january": in_scope_actuals(con),
        "forecast_rows": n_fc,
        "publish_window": [p_min, p_max],
        "ingested_at": row[0] if row else None,
    }


def _parse_dt(ts: str) -> str:
    return ts.replace("Z", "")


def run_ingestion(client: ElexonClient | None = None) -> dict:
    """Fetch both datasets and (re)write the local store. Idempotent."""
    client = client or ElexonClient(ELEXON_BASE_URL)
    con = connect()
    try:
        started = datetime.now(UTC).isoformat()

        actuals = client.wind_actuals(ACTUALS_DATE_FROM, ACTUALS_DATE_TO)
        con.execute("DELETE FROM actuals")
        con.executemany(
            "INSERT OR REPLACE INTO actuals(start_time, generation) VALUES (?, ?)",
            [
                (_parse_dt(r["startTime"]), float(r["generation"]))
                for r in actuals
                if r.get("generation") is not None
            ],
        )

        forecasts = client.wind_forecasts(PUBLISH_WINDOW_FROM, PUBLISH_WINDOW_TO)
        con.execute("DELETE FROM forecasts")
        con.executemany(
            "INSERT OR REPLACE INTO forecasts(publish_time, start_time, generation) VALUES (?, ?, ?)",
            [
                (_parse_dt(r["publishTime"]), _parse_dt(r["startTime"]), float(r["generation"]))
                for r in forecasts
                if r.get("generation") is not None
            ],
        )

        con.execute(
            "INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)",
            ("ingested_at", started),
        )
        con.commit()

        (n_actual,) = con.execute("SELECT COUNT(*) FROM actuals").fetchone()
        (n_fc,) = con.execute("SELECT COUNT(*) FROM forecasts").fetchone()
        log.info(
            "ingestion done: %d actuals rows, %d forecast rows",
            n_actual,
            n_fc,
        )
        return {
            "actuals": n_actual,
            "forecasts": n_fc,
            "ingested_at": started,
        }
    finally:
        con.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    run_ingestion()
