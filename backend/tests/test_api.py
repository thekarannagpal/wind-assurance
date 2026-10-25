"""API-level tests over an in-memory elexon-shaped store."""
import os
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# point the store at a temp dir BEFORE importing app modules
_tmp = tempfile.mkdtemp()
os.environ["DATA_DIR"] = _tmp
os.environ["INGEST_ON_START"] = "0"

import app.main
from app.elexon import ElexonClient
from app.ingest import run_ingestion
from fastapi.testclient import TestClient


class FakeElexon(ElexonClient):
    """Deterministic stand-in for the live API."""

    def wind_actuals(self, date_from, date_to):
        rows = []
        d0 = datetime.strptime(date_from, "%Y-%m-%d")
        d1 = datetime.strptime(date_to, "%Y-%m-%d")
        cur = d0
        while cur <= d1:
            for i in range(48):
                ts = cur + timedelta(minutes=30 * i)
                rows.append(
                    {
                        "startTime": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
                        "generation": 1000 + 10 * (ts.day + i),
                    }
                )
            cur += timedelta(days=1)
        return rows

    def wind_forecasts(self, publish_from, publish_to):
        # one daily 09:30 run on D-1 covering the whole next day hourly
        rows = []
        f = datetime.strptime(publish_from, "%Y-%m-%dT%H:%M:%SZ")
        t = datetime.strptime(publish_to, "%Y-%m-%dT%H:%M:%SZ")
        cur = f
        while cur < t:
            pub = cur.replace(hour=9, minute=30, second=0)
            d0, d1 = cur.date(), cur.date() + timedelta(days=3)
            day = d0
            while day <= d1:
                for h in range(24):
                    ts = datetime(day.year, day.month, day.day) + timedelta(hours=h)
                    rows.append(
                        {
                            "publishTime": pub.strftime("%Y-%m-%dT%H:%M:%SZ"),
                            "startTime": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
                            "generation": 1000 + ts.hour,
                        }
                    )
                day += timedelta(days=1)
            cur += timedelta(days=1)
        return rows


def _seed():
    run_ingestion(FakeElexon("https://fake"))


def test_end_to_end_flow():
    _seed()
    client = TestClient(app.main.app)
    assert client.get("/api/health").json()["status"] == "ok"

    status = client.get("/api/data-status").json()
    assert status["forecast_rows"] > 0

    days = client.get("/api/days").json()
    jandays = [d["day"] for d in days]
    assert "2026-01-01" in jandays and "2026-01-31" in jandays
    assert len(jandays) == 31

    day = client.get("/api/day/2026-01-08").json()
    slots = day["slots"]
    assert len(slots) == 48
    assert day["cutoff"]["publish_time"] == "2026-01-07T09:30:00"
    assert all(s["decision_forecast"] is not None for s in slots[:46])
    m = day["metrics"]["decision"]
    assert m and m["n"] >= 40
    assert day["metrics"]["persistence"] is not None

    summary = client.get("/api/summary").json()
    assert summary["kpi"]["n_slots"] > 0
    assert len(summary["daily"]) == 31
    assert {r["bucket"] for r in summary["by_lead"]} <= {"intraday", "day_ahead", "two_day", "beyond"}

    acc = client.get("/api/accuracy").json()
    assert acc["scatter"]
    assert acc["worst_slots"]
