"""Query services bridging the SQLite store and the HTTP routes."""
from __future__ import annotations

import sqlite3
from datetime import date, datetime, timedelta

from .analysis import (
    BUCKET_LABELS,
    DEFAULT_LEAD_HOURS,
    asof_series,
    bucket_for,
    clean_pairs,
    cutoff_from_lead,
    delivery_slots,
    error_quantiles,
    fmt_iso,
    metrics,
    parse_iso,
    procurement,
    slot_series,
)
from .config import SCOPE_MONTH_END, SCOPE_MONTH_START

_MONTH = (date.fromisoformat(SCOPE_MONTH_START), date.fromisoformat(SCOPE_MONTH_END))
_BUCKET_ORDER = ["intraday", "day_ahead", "two_day", "beyond"]


def month_days() -> list[date]:
    d0, d1 = _MONTH
    return [d0 + timedelta(days=i) for i in range((d1 - d0).days + 1)]


def _day_bounds(day: date) -> tuple[str, str]:
    start = datetime(day.year, day.month, day.day)
    return fmt_iso(start), fmt_iso(start + timedelta(days=1))


def _actual_hourly(con: sqlite3.Connection, day: date) -> dict[datetime, float]:
    a, b = _day_bounds(day)
    rows = con.execute(
        "SELECT start_time, generation FROM actuals WHERE start_time >= ? AND start_time < ?",
        (a, b),
    ).fetchall()
    return {parse_iso(r["start_time"]): r["generation"] for r in rows}


compute_day_cache: dict[tuple[str, float], dict] = {}


def compute_day(con: sqlite3.Connection, day: date, lead_hours: float) -> dict:
    """Assemble the full decision bundle for one delivery day (cached)."""
    key = (day.isoformat(), lead_hours)
    if key in compute_day_cache:
        return compute_day_cache[key]

    slots = delivery_slots(day)
    actual_at = _actual_hourly(con, day)
    actual_vals = [actual_at.get(s) for s in slots]

    cutoff = cutoff_from_lead(day, lead_hours)
    end_of_day = datetime(day.year, day.month, day.day) + timedelta(days=1)

    decision = asof_series(con, day, cutoff)
    latest = asof_series(con, day, end_of_day)
    decision_fc = slot_series(decision["hourly"], slots)
    latest_fc = slot_series(latest["hourly"], slots)

    # persistence benchmark: yesterday's actual, same half-hour
    prev_at = {ts + timedelta(days=1): v for ts, v in _actual_hourly(con, day - timedelta(days=1)).items()}
    persistence = [prev_at.get(s) for s in slots]

    slot_rows = []
    leads = []
    for i, s in enumerate(slots):
        dv = decision_fc[i]
        lead = None
        if dv is not None:
            pub = decision["winner"].get(s - timedelta(hours=1)) or decision["winner"].get(s)
            if pub:
                lead = (s - parse_iso(pub)).total_seconds() / 3600.0
        leads.append(lead)
        slot_rows.append(
            {
                "t": s.isoformat(),
                "actual": actual_vals[i],
                "decision_forecast": dv,
                "latest_forecast": latest_fc[i],
                "persistence": persistence[i],
                "lead_hours": round(lead, 1) if lead is not None else None,
            }
        )

    s_dec, a_dec, f_dec = clean_pairs(slots, actual_vals, decision_fc)
    _s_lat, a_lat, f_lat = clean_pairs(slots, actual_vals, latest_fc)
    _s_pt, a_pt, f_pt = clean_pairs(slots, actual_vals, persistence)

    m_dec = metrics(a_dec, f_dec)
    m_lat = metrics(a_lat, f_lat)
    m_pers = metrics(a_pt, f_pt)
    skill = (
        1.0 - m_dec["mae_mw"] / m_pers["mae_mw"]
        if m_dec and m_pers and m_pers["mae_mw"]
        else None
    )

    runs_info = []
    day_start = datetime(day.year, day.month, day.day)
    for pub, npts in sorted(decision["runs"].items()):
        runs_info.append(
            {
                "publish_time": pub,
                "points": npts,
                "lead_hours_at_day_start": round(
                    (day_start - parse_iso(pub)).total_seconds() / 3600.0, 2
                ),
            }
        )
    later_revisions = sorted(set(latest["runs"]) - set(decision["runs"]))

    mean_lead = sum(l for l in leads if l is not None) / len([l for l in leads if l is not None]) if any(l is not None for l in leads) else lead_hours

    result = {
        "day": day.isoformat(),
        "cutoff": {
            "lead_hours": lead_hours,
            "publish_time": fmt_iso(cutoff),
            "bucket": bucket_for(mean_lead),
            "mean_effective_lead_hours": round(mean_lead, 1),
        },
        "slots": slot_rows,
        "metrics": {
            "decision": m_dec,
            "latest": m_lat,
            "persistence": m_pers,
            "skill_vs_persistence": round(skill, 3) if skill is not None else None,
        },
        "procurement": (
            procurement(s_dec, a_dec, f_dec) if s_dec else None
        ),
        "runs_available": runs_info,
        "later_revisions": later_revisions,
    }
    compute_day_cache[key] = result
    return result


def month_bands(con: sqlite3.Connection, lead_hours: float = DEFAULT_LEAD_HOURS) -> dict:
    """Empirical full-month error quantiles per lead bucket (fc - a)."""
    per_bucket: dict[str, list[float]] = {}
    for day in month_days():
        info = compute_day(con, day, lead_hours)
        for s in info["slots"]:
            if s["actual"] is None or s["decision_forecast"] is None or s["lead_hours"] is None:
                continue
            b = bucket_for(s["lead_hours"])
            per_bucket.setdefault(b, []).append(s["decision_forecast"] - s["actual"])
    return {
        b: {"label": BUCKET_LABELS.get(b, b), **(error_quantiles(errs) or {})}
        for b, errs in per_bucket.items()
    }


def month_summary(con: sqlite3.Connection, lead_hours: float = DEFAULT_LEAD_HOURS) -> dict:
    """Whole-month KPIs, per-day performance, lead-time curve, slot profile."""
    daily: list[dict] = []
    per_bucket: dict[str, list[tuple[float, float]]] = {}
    per_slot: dict[int, list[float]] = {}
    month_pairs: list[tuple[float, float]] = []
    pers_pairs: list[tuple[float, float]] = []
    tot_planned = tot_achieved = tot_short = tot_surplus = 0.0

    for day in month_days():
        info = compute_day(con, day, lead_hours)
        p = info["procurement"] or {}
        tot_planned += p.get("planned_wind_gwh", 0.0)
        tot_achieved += p.get("achieved_wind_gwh", 0.0)
        tot_short += p.get("shortfall_gwh", 0.0)
        tot_surplus += p.get("untracked_surplus_gwh", 0.0)

        for i, s in enumerate(info["slots"]):
            av, fv, lh = s["actual"], s["decision_forecast"], s["lead_hours"]
            if av is None or fv is None:
                continue
            month_pairs.append((av, fv))
            if s["persistence"] is not None:
                pers_pairs.append((av, s["persistence"]))
            if lh is not None:
                per_bucket.setdefault(bucket_for(lh), []).append((av, fv))
            per_slot.setdefault(i, []).append(fv - av)

        daily.append(
            {
                "day": day.isoformat(),
                "planned_wind_gwh": round(p.get("planned_wind_gwh", 0.0), 3),
                "achieved_wind_gwh": round(p.get("achieved_wind_gwh", 0.0), 3),
                "energy_gap_gwh": round(p.get("energy_gap_gwh", 0.0), 3),
                "mae_mw": (info["metrics"]["decision"] or {}).get("mae_mw"),
                "bias_mw": (info["metrics"]["decision"] or {}).get("bias_mw"),
                "n_slots": (info["metrics"]["decision"] or {}).get("n", 0),
            }
        )

    by_lead = []
    for b in _BUCKET_ORDER:
        pairs = per_bucket.get(b)
        if not pairs:
            continue
        m = metrics([x[0] for x in pairs], [x[1] for x in pairs]) or {}
        by_lead.append({"bucket": b, "label": BUCKET_LABELS.get(b, b), **m})

    month_m = metrics([x[0] for x in month_pairs], [x[1] for x in month_pairs]) if month_pairs else None
    pers_m = metrics([x[0] for x in pers_pairs], [x[1] for x in pers_pairs]) if pers_pairs else None
    skill = (
        1.0 - month_m["mae_mw"] / pers_m["mae_mw"]
        if month_m and pers_m and pers_m["mae_mw"]
        else None
    )

    slot_profile = [
        {
            "slot": idx,
            "time": f"{idx // 2:02d}:{'00' if idx % 2 == 0 else '30'}",
            "mean_error_mw": round(sum(vals) / len(vals), 1),
            "mae_mw": round(sum(abs(v) for v in vals) / len(vals), 1),
        }
        for idx, vals in sorted(per_slot.items())
    ]

    over = len([d for d in daily if d["energy_gap_gwh"] < 0])
    under = len([d for d in daily if d["energy_gap_gwh"] > 0])

    worst = sorted(daily, key=lambda d: abs(d["energy_gap_gwh"]), reverse=True)[:5]

    bands = {}
    for b, bys in per_bucket.items():
        errs_b = [fv - av for av, fv in bys]
        bands[b] = {"label": BUCKET_LABELS.get(b, b), **(error_quantiles(errs_b) or {})}

    return {
        "month": _MONTH[0].strftime("%B %Y"),
        "lead_hours": lead_hours,
        "kpi": {
            "planned_wind_gwh": round(tot_planned, 1),
            "achieved_wind_gwh": round(tot_achieved, 1),
            "shortfall_gwh": round(tot_short, 1),
            "untracked_surplus_gwh": round(tot_surplus, 1),
            "mae_mw": (month_m or {}).get("mae_mw"),
            "wape": (month_m or {}).get("wape"),
            "bias_mw": (month_m or {}).get("bias_mw"),
            "n_slots": (month_m or {}).get("n"),
            "skill_vs_persistence": round(skill, 3) if skill is not None else None,
            "days_under_forecast": over,
            "days_over_forecast": under,
        },
        "daily": daily,
        "by_lead": by_lead,
        "slot_profile": slot_profile,
        "worst_days": worst,
    }


def accuracy_page(con: sqlite3.Connection, lead_hours: float = DEFAULT_LEAD_HOURS) -> dict:
    """Data for the accuracy-explorer view (supports any cut-off)."""
    summary = month_summary(con, lead_hours)
    bands = month_bands(con, lead_hours)
    scatter: list[dict] = []
    worst_slots: list[dict] = []
    for day in month_days():
        info = compute_day(con, day, lead_hours)
        for s in info["slots"]:
            if s["actual"] is None or s["decision_forecast"] is None:
                continue
            scatter.append(
                {
                    "actual_mw": round(s["actual"], 0),
                    "forecast_mw": round(s["decision_forecast"], 0),
                    "day": day.isoformat(),
                }
            )
            worst_slots.append(
                {
                    "t": s["t"],
                    "actual_mw": round(s["actual"], 0),
                    "forecast_mw": round(s["decision_forecast"], 0),
                    "error_mw": round(s["decision_forecast"] - s["actual"], 0),
                }
            )
    worst_slots.sort(key=lambda r: abs(r["error_mw"]), reverse=True)
    return {
        "month": summary["month"],
        "lead_hours": lead_hours,
        "by_lead": summary["by_lead"],
        "slot_profile": summary["slot_profile"],
        "kpi": summary["kpi"],
        "bands": bands,
        "scatter": scatter,
        "worst_slots": worst_slots[:20],
    }


def day_overview(con: sqlite3.Connection) -> list[dict]:
    days: list[dict] = []
    for day in month_days():
        info = compute_day(con, day, DEFAULT_LEAD_HOURS)
        m = info["metrics"]["decision"] or {}
        days.append(
            {
                "day": day.isoformat(),
                "mean_wind_mw": m.get("mean_actual_mw"),
                "energy_gap_gwh": (info["procurement"] or {}).get("energy_gap_gwh"),
                "runs_before_cutoff": len(info["runs_available"]),
                "later_revisions": len(info["later_revisions"]),
            }
        )
    return days
