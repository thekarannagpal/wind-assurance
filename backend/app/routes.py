"""HTTP API: decision views, accuracy analytics and data status."""
from __future__ import annotations

import sqlite3
from datetime import UTC, date, datetime

from fastapi import APIRouter, HTTPException, Query

from . import service
from .analysis import DEFAULT_LEAD_HOURS
from .config import SCOPE_MONTH_END, SCOPE_MONTH_START
from .ingest import table_stats

router = APIRouter(prefix="/api")


def _open_db() -> sqlite3.Connection:
    from .ingest import connect

    return connect()


def _validate_day(day: str) -> date:
    try:
        d = date.fromisoformat(day)
    except ValueError:
        raise HTTPException(status_code=400, detail="day must be YYYY-MM-DD")
    lo, hi = SCOPE_MONTH_START, SCOPE_MONTH_END
    if not (lo <= d.isoformat() <= hi):
        raise HTTPException(status_code=400, detail=f"day must be in scope {lo}..{hi}")
    return d


@router.get("/health")
def health():
    return {
        "status": "ok",
        "time": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }


@router.get("/data-status")
def data_status():
    con = _open_db()
    try:
        return table_stats(con)
    finally:
        con.close()


@router.get("/summary")
def summary(lead_hours: float = Query(DEFAULT_LEAD_HOURS, ge=0, le=96)):
    con = _open_db()
    try:
        return service.month_summary(con, lead_hours)
    finally:
        con.close()


@router.get("/days")
def days():
    """Lightweight per-day list for pickers/calendar UI."""
    con = _open_db()
    try:
        return service.day_overview(con)
    finally:
        con.close()


@router.get("/day/{day}")
def day_detail(
    day: str,
    lead_hours: float = Query(DEFAULT_LEAD_HOURS, ge=0, le=96),
):
    d = _validate_day(day)
    con = _open_db()
    try:
        info = service.compute_day(con, d, lead_hours)
        info["band"] = service.month_bands(con, lead_hours)
        return info
    finally:
        con.close()


@router.get("/accuracy")
def accuracy(lead_hours: float = Query(DEFAULT_LEAD_HOURS, ge=0, le=96)):
    con = _open_db()
    try:
        return service.accuracy_page(con, lead_hours)
    finally:
        con.close()
