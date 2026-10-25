"""Domain/analysis layer: as-of forecast reconstruction, accuracy metrics and
procurement framing. All timestamps are UTC. Great Britain is on GMT in
January, so UTC calendar days map one-to-one onto settlement days.
"""
from __future__ import annotations

import sqlite3
from bisect import bisect_right
from datetime import date, datetime, timedelta
from statistics import quantiles

# Lead-time buckets: hours between forecast publish-time and delivery start.
LEAD_BUCKETS: list[tuple[str, float, float]] = [
    ("intraday", 0, 12),
    ("day_ahead", 12, 36),
    ("two_day", 36, 60),
    ("beyond", 60, 1e9),
]
BUCKET_LABELS = {
    "intraday": "Intraday (<12h)",
    "day_ahead": "Day-ahead (12-36h)",
    "two_day": "Two-day (36-60h)",
    "beyond": "Beyond 60h",
}
# UK day-ahead auction gate closure is 09:30 GMT on D-1 = 14.5h before start.
DEFAULT_LEAD_HOURS = 14.5

MAPE_MIN_ACTUAL_MW = 500.0  # guard MAPE against near-zero actuals


# ---------------------------------------------------------------- time utils
def parse_iso(ts: str) -> datetime:
    return datetime.strptime(ts, "%Y-%m-%dT%H:%M:%S")


def fmt_iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


def cutoff_from_lead(day: date, lead_hours: float) -> datetime:
    """Decision cut-off = `lead_hours` before delivery-day start (00:00 UTC)."""
    start = datetime(day.year, day.month, day.day)
    return start - timedelta(hours=lead_hours)


def delivery_slots(day: date) -> list[datetime]:
    """The 48 half-hour delivery slots of a settlement day, in UTC."""
    start = datetime(day.year, day.month, day.day)
    return [start + timedelta(minutes=30 * i) for i in range(48)]


def bucket_for(lead_hours: float) -> str:
    for name, lo, hi in LEAD_BUCKETS:
        if lo <= lead_hours < hi:
            return name
    return "beyond"


# ------------------------------------------------------------ series helpers
def interpolate_hourly(hourly: list[tuple[datetime, float]], slot: datetime) -> float | None:
    """Linear interpolation of an hourly series onto a half-hour slot.

    `hourly` is sorted ascending. Returns None when slot is outside coverage.
    """
    if not hourly:
        return None
    ts_list = [t for t, _ in hourly]
    if slot < ts_list[0]:
        return None
    idx = bisect_right(ts_list, slot)
    if idx >= len(hourly):
        return None
    if idx > 0 and ts_list[idx - 1] == slot:
        return hourly[idx - 1][1]
    t0, v0 = hourly[idx - 1]
    t1, v1 = hourly[idx]
    span = (t1 - t0).total_seconds()
    frac = (slot - t0).total_seconds() / span
    return v0 + frac * (v1 - v0)


def asof_series(
    con: sqlite3.Connection, day: date, cutoff: datetime
) -> dict:
    """Merged 'latest-run-wins' forecast covering the delivery day.

    Only runs published <= cutoff are considered. Returns::
      {"hourly": [(ts, value)], ...}     covering day-6h .. day+30h,
      {"runs": {publish: n_points}},     per-run point counts,
      {"winner": {ts: publish}}          which run supplied each point.
    """
    day_start = datetime(day.year, day.month, day.day)
    day_from = fmt_iso(day_start - timedelta(hours=6))  # margin for interpolation
    day_to = fmt_iso(day_start + timedelta(days=1, hours=6))
    rows = con.execute(
        """SELECT publish_time, start_time, generation FROM forecasts
           WHERE start_time >= ? AND start_time < ? AND publish_time <= ?
           ORDER BY publish_time""",
        (day_from, day_to, fmt_iso(cutoff)),
    ).fetchall()

    runs: dict[str, int] = {}
    merged: dict[datetime, float] = {}
    winner: dict[datetime, str] = {}
    for r in rows:
        runs[r["publish_time"]] = runs.get(r["publish_time"], 0) + 1
        merged[parse_iso(r["start_time"])] = r["generation"]
        winner[parse_iso(r["start_time"])] = r["publish_time"]
    return {
        "hourly": [(k, merged[k]) for k in sorted(merged)],
        "runs": runs,
        "winner": winner,
    }


def slot_series(
    hourly: list[tuple[datetime, float]], slots: list[datetime]
) -> list[float | None]:
    return [interpolate_hourly(hourly, s) for s in slots]


# ------------------------------------------------------------------- metrics
def clean_pairs(
    slots: list[datetime],
    actual: list[float | None],
    forecast: list[float | None],
) -> tuple[list[datetime], list[float], list[float]]:
    s, a, f = [], [], []
    for slot, av, fv in zip(slots, actual, forecast):
        if av is not None and fv is not None:
            s.append(slot)
            a.append(av)
            f.append(fv)
    return s, a, f


def metrics(actual: list[float], forecast: list[float]) -> dict | None:
    n = len(actual)
    if n == 0:
        return None
    errs = [f - a for a, f in zip(actual, forecast)]
    abs_errs = [abs(e) for e in errs]
    mae = sum(abs_errs) / n
    rmse = (sum(e * e for e in errs) / n) ** 0.5
    bias = sum(errs) / n
    total_actual = sum(abs(a) for a in actual)
    wape = (sum(abs_errs) / total_actual) if total_actual > 0 else None
    usable = [(a, f) for a, f in zip(actual, forecast) if abs(a) > MAPE_MIN_ACTUAL_MW]
    mape = (
        sum(abs(f - a) / abs(a) for a, f in usable) / len(usable) if usable else None
    )
    return {
        "n": n,
        "mae_mw": round(mae, 1),
        "rmse_mw": round(rmse, 1),
        "bias_mw": round(bias, 1),
        "wape": round(wape, 4) if wape is not None else None,
        "mape": round(mape, 4) if mape is not None else None,
        "mean_actual_mw": round(total_actual / n, 1),
    }


def error_quantiles(errs: list[float]) -> dict | None:
    if len(errs) < 5:
        return None
    q = quantiles(errs, n=10, method="inclusive")  # q[0]=P10 ... q[8]=P90
    return {"p10": round(q[0], 1), "p50": round(q[4], 1), "p90": round(q[8], 1)}


# ------------------------------------------------------------------ procurement
def procurement(
    slots: list[datetime], actual: list[float], forecast: list[float]
) -> dict:
    """Energy framing of the decision-forecast miss over the measured slots."""
    planned_gwh = sum(forecast) / 2000.0  # MW * 0.5h -> MWh/2 -> GWh
    achieved_gwh = sum(actual) / 2000.0
    shortfall_gwh = sum(max(0.0, f - a) for a, f in zip(actual, forecast)) / 2000.0
    surplus_gwh = sum(max(0.0, a - f) for a, f in zip(actual, forecast)) / 2000.0
    gap_peak_ts, gap_peak_mw = max(
        ((s, abs(f - a)) for s, a, f in zip(slots, actual, forecast)),
        key=lambda x: x[1],
        default=(None, 0.0),
    )
    return {
        "planned_wind_gwh": round(planned_gwh, 3),
        "achieved_wind_gwh": round(achieved_gwh, 3),
        "energy_gap_gwh": round(achieved_gwh - planned_gwh, 3),
        "shortfall_gwh": round(shortfall_gwh, 3),
        "untracked_surplus_gwh": round(surplus_gwh, 3),
        "largest_halfhour_gap_mw": round(gap_peak_mw, 1),
        "largest_halfhour_gap_ts": (
            gap_peak_ts.strftime("%Y-%m-%d %H:%M") if gap_peak_ts else None
        ),
    }
