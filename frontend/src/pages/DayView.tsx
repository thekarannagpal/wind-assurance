import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import {
  Area,
  ComposedChart,
  CartesianGrid,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { api } from "../lib/api";
import { ChartCard, Kpi, Loading, ErrorState, fmtGwh, fmtMw, fmtPct, fmtNum } from "../components/ui";

const GATE_CLOSURE = 14.5;

const fmtK = (v: number) => (v === 0 ? "0" : `${(v / 1000).toFixed(0)}k`);

const leadLabel = (h: number) =>
  `${h} h before delivery-day start`;

function DayCell({ day, active, gap, onClick }: { day: string; active: boolean; gap: number | null; onClick: () => void }) {
  const cls = active
    ? "bg-[#007AFF] text-white shadow-[0_1px_2px_rgba(0,122,255,0.35)]"
    : gap == null
      ? "bg-[#E9E9EB] text-[#3A3A3C]"
      : gap < -50
        ? "bg-[#FFD3CF] text-[#B3261E]"
        : gap < 0
          ? "bg-[#FEEAE8] text-[#D70015]"
          : gap > 0
            ? "bg-[#D9F3E3] text-[#1B7F3B]"
            : "bg-[#E9E9EB] text-[#3A3A3C]";
  return (
    <button key={day} onClick={onClick} className={`chip ${cls}`} title={day}>
      {day.slice(8)}
    </button>
  );
}

export default function DayView() {
  const params = useParams();
  const [day, setDay] = useState<string>(params.day ?? "2026-01-05");
  const [leadHours, setLeadHours] = useState<number>(GATE_CLOSURE);

  const { data: days } = useQuery({ queryKey: ["days"], queryFn: api.days });

  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: ["day", day, leadHours],
    queryFn: () => api.day(day, leadHours),
    placeholderData: (prev) => prev,
  });

  const band = useMemo(() => data?.band[data.cutoff.bucket] ?? {}, [data]);
  const chart = useMemo(() => {
    if (!data) return [];
    return data.slots.map((s) => ({
      time: s.t.slice(11),
      actual: s.actual,
      decision: s.decision_forecast,
      band_hi: s.decision_forecast != null && band.p90 != null ? +(s.decision_forecast + band.p90).toFixed(0) : null,
      band_lo: s.decision_forecast != null && band.p10 != null ? +(s.decision_forecast + band.p10).toFixed(0) : null,
      latest: s.latest_forecast,
      persistence: s.persistence,
    }));
  }, [data, band]);

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorState message={String(error)} />;

  const m = data.metrics;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Decision view — {day}</h1>
        <div className="text-xs text-[#86868B]">
          {isFetching ? "updating…" : ""}
        </div>
      </div>

      <div className="card space-y-4">
        <div>
          <div className="kpi-label mb-2">Delivery day in January 2026</div>
          <div className="flex flex-wrap gap-1">
            {days?.map((d) => (
              <DayCell
                key={d.day}
                day={d.day}
                gap={d.energy_gap_gwh}
                active={d.day === day}
                onClick={() => setDay(d.day)}
              />
            ))}
          </div>
        </div>
        <div>
          <div className="kpi-label mb-1">
            Decision cut-off — how fresh a forecast was available?
          </div>
          <input
            type="range"
            min={1}
            max={80}
            step={2.5}
            value={leadHours}
            onChange={(e) => setLeadHours(+e.target.value)}
            className="w-full accent-[#007AFF]"
          />
          <div className="flex justify-between text-xs text-[#6E6E73]">
            <span>
              latest info before {leadLabel(leadHours)} — {data.cutoff.publish_time.replace("T", " ")} UTC
            </span>
            <span>
              {leadHours === GATE_CLOSURE ? "◆ 09:30 gate closure default" : `+${(leadHours - GATE_CLOSURE).toFixed(1)}h vs default`}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-[#86868B]">
            {data.runs_available.length} forecast run(s) available at cut-off ·{" "}
            {data.later_revisions.length} later revision(s) before delivery close · shaded
            band = {band.label ?? "January"} P10–P90 forecast errors
          </div>
        </div>
      </div>

      <ChartCard title="Wind generation — decision forecast vs actual" hint="half-hourly, MW">
        <div className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chart}>
              <CartesianGrid stroke="#E5E5EA" vertical={false} />
              <XAxis
                dataKey="time"
                tick={{ fill: "#6E6E73", fontSize: 10 }}
                interval={7}
                tickFormatter={(v: string) => v.slice(0, 2) + "h"}
              />
              <YAxis
                tick={{ fill: "#6E6E73", fontSize: 11 }}
                width={44}
                domain={[0, 22000]}
                ticks={[0, 5000, 10000, 15000, 20000]}
                tickFormatter={fmtK}
              />
              <Tooltip formatter={(v: any) => `${v.toLocaleString()} MW`} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area
                dataKey={(row: any) => [row?.band_lo, row?.band_hi] as [number, number]}
                name="January P10–P90 error band"
                fill="rgba(255,59,48,0.15)"
                stroke="rgba(255,59,48,0.25)"
                strokeWidth={1}
                connectNulls
              />
              <Line isAnimationActive={false} type="monotone" dataKey="actual" name="Actual" stroke="#34C759" strokeWidth={2} dot={false} />
              <Line isAnimationActive={false} type="stepAfter" dataKey="decision" name="Decision forecast (as-of cut-off)" stroke="#007AFF" strokeWidth={2} dot={false} />
              <Line isAnimationActive={false} type="stepAfter" dataKey="latest" name="Latest forecast (final revision)" stroke="#5856D6" strokeDasharray="4 3" dot={false} />
              <Line isAnimationActive={false} type="monotone" dataKey="persistence" name="Persistence (yesterday's actual)" stroke="#AEAEB2" dot={false} />
              <ReferenceLine y={0} stroke="#C7C7CC" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="Cut-off forecast series"
          value={fmtNum(m.decision?.n, 0)}
          sub={`slots with forecast & actual · effective lead ${data.cutoff.mean_effective_lead_hours}\u00A0h`}
        />
        <Kpi label="MAE" value={fmtNum(m.decision?.mae_mw, 0)} unit="MW" sub={`RMSE ${fmtMw(m.decision?.rmse_mw)}`} tone="warn" />
        <Kpi
          label="Bias"
          value={fmtNum(m.decision?.bias_mw, 0)}
          unit="MW"
          sub={m.decision && m.decision.bias_mw > 0 ? "forecast too optimistic" : "forecast too pessimistic"}
          tone={m.decision && m.decision.bias_mw > 0 ? "bad" : "good"}
        />
        <Kpi
          label="Skill vs persistence"
          value={m.skill_vs_persistence == null ? "—" : `${(m.skill_vs_persistence * 100).toFixed(0)}%`}
          sub={`persistence MAE ${fmtMw(m.persistence?.mae_mw)}`}
        />
        <Kpi
          label="Planned wind energy"
          value={fmtNum(data.procurement?.planned_wind_gwh, 1)}
          unit="GWh"
          sub={`achieved ${fmtGwh(data.procurement?.achieved_wind_gwh)}`}
        />
        <Kpi
          label="Unplanned shortfall"
          value={fmtNum(data.procurement?.shortfall_gwh, 1)}
          unit="GWh"
          sub={data.procurement ? `peak half-hour gap ${fmtNum(data.procurement.largest_halfhour_gap_mw, 0)} MW at ${data.procurement.largest_halfhour_gap_ts}` : undefined}
          tone="bad"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Forecast runs available before cut-off" hint="Elexon WINDFOR publishes ~8 runs/day">
          <table className="data">
            <thead>
              <tr>
                <th>Publish time (UTC)</th>
                <th>Points covering the day</th>
                <th>Lead at delivery start</th>
              </tr>
            </thead>
            <tbody>
              {data.runs_available.map((r) => (
                <tr key={r.publish_time}>
                  <td>{r.publish_time.replace("T", " ")}</td>
                  <td>{r.points}</td>
                  <td>{r.lead_hours_at_day_start} h</td>
                </tr>
              ))}
              {data.later_revisions.length > 0 && (
                <tr>
                  <td colSpan={3} className="text-xs text-[#86868B]">
                    + {data.later_revisions.length} later revision(s) only used for the “latest forecast” line
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </ChartCard>

        <ChartCard title="Accuracy metrics at this cut-off" hint="decision forecast vs actual">
          <table className="data">
            <tbody>
              <tr>
                <td>MAE / RMSE</td>
                <td>{fmtMw(m.decision?.mae_mw)} / {fmtMw(m.decision?.rmse_mw)}</td>
              </tr>
              <tr>
                <td>WAPE (energy-weighted)</td>
                <td>{fmtPct(m.decision?.wape)}</td>
              </tr>
              <tr>
                <td>MAPE (gen &gt; 500 MW)</td>
                <td>{fmtPct(m.decision?.mape)}</td>
              </tr>
              <tr>
                <td>Skill vs persistence</td>
                <td>{m.skill_vs_persistence == null ? "—" : fmtPct(m.skill_vs_persistence, 0)}</td>
              </tr>
              <tr>
                <td>Month P10/P90 error for this bucket</td>
                <td>
                  {band.p10?.toLocaleString() ?? "—"} / {band.p90?.toLocaleString() ?? "—"} MW
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-[#86868B]">
            P10/P90 come from all January half-hours at the same lead bucket: the envelope
            spans forecast + P10 … forecast + P90. A conservative hedge would plan wind at
            the lower edge of the band instead of the forecast value.
          </p>
        </ChartCard>
      </div>
    </div>
  );
}
