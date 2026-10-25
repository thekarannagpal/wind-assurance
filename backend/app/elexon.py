"""Thin, dependency-light HTTP client for the Elexon BMRS Insights API.

Endpoints used (challenge scope):
- /datasets/FUELHH/stream : half-hourly actual wind generation (fuelType=WIND)
- /datasets/WINDFOR/stream : hourly wind forecasts, keyed by publishTime+startTime
"""
from __future__ import annotations

import logging
import time
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx

log = logging.getLogger("elexon")

# ~8 forecast runs per day, each covering a few days: 5 calendar days per call
# keeps responses comfortably < 5 MB while staying well within run windows.
_CHUNK_DAYS = 5
_MAX_RETRIES = 4
_TIMEOUT = httpx.Timeout(180.0, connect=30.0)


def _iso(d: date | datetime) -> str:
    if isinstance(d, datetime) and d.tzinfo is not None:
        return d.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    return d.strftime("%Y-%m-%d")


class ElexonClient:
    def __init__(self, base_url: str) -> None:
        self._base = base_url.rstrip("/")

    def _get_json(self, path: str, params: dict[str, str]) -> Any:
        url = f"{self._base}{path}"
        attempt = 0
        while True:
            attempt += 1
            try:
                with httpx.Client(timeout=_TIMEOUT, headers={"Accept": "application/json"}) as c:
                    resp = c.get(url, params=params)
                resp.raise_for_status()
                return resp.json()
            except Exception as exc:
                if attempt >= _MAX_RETRIES:
                    raise
                wait = 2 ** attempt
                log.warning("GET %s failed (%s), retry %d in %ss", url, exc, attempt, wait)
                time.sleep(wait)

    @staticmethod
    def _split_window(from_dt: datetime, to_dt: datetime, days: int):
        cur = from_dt
        while cur < to_dt:
            nxt = min(cur + timedelta(days=days), to_dt)
            yield cur, nxt
            cur = nxt

    def wind_actuals(self, date_from: str, date_to: str) -> list[dict[str, Any]]:
        """Half-hourly actual WIND generation for settlement-date range."""
        rows: list[dict[str, Any]] = []
        start = date.fromisoformat(date_from)
        end = date.fromisoformat(date_to)
        cur = start
        while cur <= end:
            nxt = min(cur + timedelta(days=20), end)
            data = self._get_json(
                "/datasets/FUELHH/stream",
                {
                    "settlementDateFrom": cur.isoformat(),
                    "settlementDateTo": nxt.isoformat(),
                    "fuelType": "WIND",
                    "format": "json",
                },
            )
            rows.extend(data or [])
            cur = nxt + timedelta(days=1)
        return rows

    def wind_forecasts(self, publish_from: str, publish_to: str) -> list[dict[str, Any]]:
        """All forecast runs published in [publish_from, publish_to)."""
        rows: list[dict[str, Any]] = []
        fmt = "%Y-%m-%dT%H:%M:%SZ"
        f = datetime.strptime(publish_from, fmt).replace(tzinfo=UTC)
        t = datetime.strptime(publish_to, fmt).replace(tzinfo=UTC)
        for a, b in self._split_window(f, t, _CHUNK_DAYS):
            data = self._get_json(
                "/datasets/WINDFOR/stream",
                {
                    "publishDateTimeFrom": _iso(a),
                    "publishDateTimeTo": _iso(b),
                    "format": "json",
                },
            )
            rows.extend(data or [])
        return rows
