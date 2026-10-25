"""Unit tests for the analysis layer with synthetic, deterministic data."""
from datetime import date, datetime, timedelta

from app.analysis import (
    bucket_for,
    cutoff_from_lead,
    delivery_slots,
    error_quantiles,
    interpolate_hourly,
    metrics,
    procurement,
)


def test_delivery_slots_are_48_halfhours():
    slots = delivery_slots(date(2026, 1, 5))
    assert len(slots) == 48
    assert slots[0] == datetime(2026, 1, 5, 0, 0)
    assert slots[-1] == datetime(2026, 1, 5, 23, 30)


def test_cutoff_from_lead():
    # 14.5h before midnight => 09:30 on D-1 (gate closure)
    assert cutoff_from_lead(date(2026, 1, 5), 14.5) == datetime(2026, 1, 4, 9, 30)


def test_bucket_for():
    assert bucket_for(5) == "intraday"
    assert bucket_for(14.5) == "day_ahead"
    assert bucket_for(40) == "two_day"
    assert bucket_for(70) == "beyond"


def test_interpolate_hourly_midpoint_and_edges():
    hourly = [(datetime(2026, 1, 5, 10), 1000.0), (datetime(2026, 1, 5, 11), 2000.0)]
    # exact hour
    assert interpolate_hourly(hourly, datetime(2026, 1, 5, 10)) == 1000.0
    # half-hour in between -> midpoint
    assert interpolate_hourly(hourly, datetime(2026, 1, 5, 10, 30)) == 1500.0
    # outside coverage -> None
    assert interpolate_hourly(hourly, datetime(2026, 1, 5, 12)) is None
    assert interpolate_hourly(hourly, datetime(2026, 1, 5, 9)) is None


def test_metrics_known_values():
    actual = [100.0, 200.0, 300.0, 400.0, 500.0, 600.0]
    forecast = [110.0, 190.0, 300.0, 500.0, 400.0, 600.0]
    m = metrics(actual, forecast)
    assert m["n"] == 6
    assert m["mae_mw"] == round((10 + 10 + 0 + 100 + 100 + 0) / 6, 1)
    assert m["bias_mw"] == round((10 - 10 + 0 + 100 - 100 + 0) / 6, 1)
    # wape = sum|e| / sum|a|
    assert m["wape"] == round((10 + 10 + 0 + 100 + 100 + 0) / 2100, 4)


def test_error_quantiles_bounds():
    errs = list(range(101))  # 0..100
    q = error_quantiles(errs)
    assert q["p10"] <= q["p50"] <= q["p90"]
    assert q["p10"] == 10.0
    assert q["p90"] == 90.0
    assert q["p50"] == 50.0


def test_procurement_energy_framing():
    slots = [
        datetime(2026, 1, 5, 0, 0) + timedelta(minutes=30 * i) for i in range(4)
    ]
    actual = [100.0, 100.0, 100.0, 100.0]
    forecast = [150.0, 120.0, 80.0, 100.0]
    p = procurement(slots, actual, forecast)
    # planned energy = 450 MW * 0.5h = 0.225 GWh
    assert abs(p["planned_wind_gwh"] - 0.225) < 1e-9
    # shortfall = 50+20 MW halfhours = 70*0.5 = 0.035 GWh
    assert abs(p["shortfall_gwh"] - 0.035) < 1e-9
    # largest single half-hour gap = 50 MW
    assert p["largest_halfhour_gap_mw"] == 50.0
