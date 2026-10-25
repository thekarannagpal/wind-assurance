import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import { api } from "../lib/api";
import { ChartCard, Kpi, Loading, ErrorState, fmtPct, fmtNum } from "../components/ui";

const GATE_CLOSURE = 14.5;

const fmtK = (v: number) => (v === 0 ? "0" : `${(v / 1000).toFixed(0)}k`);

export default function Accuracy() {
  const [leadHours, setLeadHours] = useState<number>(GATE_CLOSURE);
  const { data, error, isLoading } = useQuery({
    queryKey: ["accuracy", leadHours],
    queryFn: () => api.accuracy(leadHours),
    placeholderData: (prev) => prev,
  });

  if (isLoading || !data) return isLoading ? <Loading /> : <ErrorState message={String(error)} />;

  // error histogram in 500 MW bins across the month (client-side from scatter pairs)
  const edges: number[] = [];
  for (let e = -6000; e <= 6000; e += 500) edges.push(e);
  const errors = data.scatter.map((p) => p.forecast_mw - p.actual_mw);
  const hist = edges.slice(0, -1).map((lo, i) => ({
    lo,
    hi: edges[i + 1],
    label: lo === 0 ? "0" : `${lo >= 0 ? "+" : ""}${lo / 1000}k`,
    count: errors.filter((e) => e >= lo && e < edges[i + 1]).length,
  }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Forecast accuracy explorer — {data.month}</h1>
        <p className="mt-1 text-sm text-[#6E6E73]">
          How trustworthy was the day-ahead wind forecast? Same decision points as the
          overview (runs published by 09:30 on D-1) unless you move the cut-off.
        </p>
      </div>

      <div className="card space-y-3">
        <div className="kpi-label">Decision cut-off (hours before delivery-day start)</div>
        <input
          type="range"
          min={1}
          max={80}
          step={2.5}
          value={leadHours}
          onChange={(e) => setLeadHours(+e.target.value)}
          className="w-full accent-[#007AFF]"
        />
        <div className="text-xs text-[#6E6E73]">
          {data.by_lead.length} lead buckets observed ·{" "}
          {Object.values(data.bands)
            .map((v) => `${v.label}: P50 ${v.p50 ?? "—"} MW`)
            .join(" · ")}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
        <Kpi label="Evaluated slots" value={fmtNum(data.kpi.n_slots, 0)} />
        <Kpi label="MAE" value={fmtNum(data.kpi.mae_mw, 1)} unit="MW" tone="warn" />
        <Kpi label="WAPE" value={fmtPct(data.kpi.wape)} tone="warn" />
        <Kpi
          label="Bias"
          value={data.kpi.bias_mw != null && data.kpi.bias_mw > 0 ? "+" + fmtNum(data.kpi.bias_mw, 1) : fmtNum(data.kpi.bias_mw, 1)}
          unit="MW"
          sub={data.kpi.bias_mw != null && data.kpi.bias_mw > 0 ? "over-forecast" : "under-forecast"}
        />
        <Kpi
          label="Skill vs persistence"
          value={data.kpi.skill_vs_persistence == null ? "—" : fmtPct(data.kpi.skill_vs_persistence, 0)}
          tone="good"
        />
        <Kpi label="Shortfall energy" value={fmtNum(data.kpi.shortfall_gwh, 0)} unit="GWh" tone="bad" />
        <Kpi label="Surplus energy" value={fmtNum(data.kpi.untracked_surplus_gwh, 0)} unit="GWh" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Forecast vs actual (MW)"
          hint="every half-hour of January at this cut-off"
        >
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 12, bottom: 8, left: 8 }}>
                <CartesianGrid stroke="#E5E5EA" />
                <XAxis
                  dataKey="actual_mw"
                  name="Actual"
                  type="number"
                  domain={[0, 22000]}
                  ticks={[0, 5000, 10000, 15000, 20000]}
                  tick={{ fill: "#6E6E73", fontSize: 11 }}
                  tickFormatter={fmtK}
                />
                <YAxis
                  dataKey="forecast_mw"
                  name="Forecast"
                  type="number"
                  domain={[0, 22000]}
                  ticks={[0, 5000, 10000, 15000, 20000]}
                  tick={{ fill: "#6E6E73", fontSize: 11 }}
                  width={40}
                  tickFormatter={fmtK}
                />
                <ZAxis range={[18, 18]} />
                <Tooltip
                  formatter={(v: any) => `${v.toLocaleString()} MW`}
                  labelFormatter={() => ""}
                />
                <ReferenceLine
                  segment={[
                    { x: 0, y: 0 },
                    { x: 20000, y: 20000 },
                  ]}
                  stroke="#AEAEB2"
                  strokeDasharray="4 4"
                />
                <Scatter isAnimationActive={false} data={data.scatter} fill="rgba(0,122,255,0.5)" data-testid="scatter-points" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Error distribution" hint="fc − actual, 500 MW bins (MW)">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hist}>
                <CartesianGrid stroke="#E5E5EA" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#6E6E73", fontSize: 10 }} interval={1} />
                <YAxis tick={{ fill: "#6E6E73", fontSize: 11 }} width={40} />
                <Tooltip labelFormatter={(_, p: any) => `${p?.[0]?.payload?.lo ?? ""}…${p?.[0]?.payload?.hi ?? ""} MW`} />
                <ReferenceLine x="0" stroke="#AEAEB2" />
                <Bar isAnimationActive={false} dataKey="count" name="half-hours">
                  {hist.map((h) => (
                    <Cell key={h.lo} fill={h.lo >= 0 ? "#FF3B30" : "#32ADE6"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      <ChartCard
        title="Error by forecast lead time"
        hint="MAE / Bias (MW) per bucket — accuracy should degrade as lead grows"
      >
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data.by_lead}>
              <CartesianGrid stroke="#E5E5EA" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "#6E6E73", fontSize: 11 }} />
              <YAxis
                tick={{ fill: "#6E6E73", fontSize: 11 }}
                width={46}
                domain={[0, 2400]}
                ticks={[0, 600, 1200, 1800, 2400]}
                tickFormatter={fmtNum}
              />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar
                isAnimationActive={false}
                dataKey="mae_mw"
                name="MAE"
                fill="#007AFF"
                barSize={44}
                radius={[6, 6, 0, 0]}
              />
              <Line
                isAnimationActive={false}
                dataKey="bias_mw"
                name="Bias"
                stroke="#FF9500"
                strokeWidth={2}
                dot={{ r: 3, fill: "#FF9500", strokeWidth: 0 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Monthly error bands per lead bucket" hint="empirical quantiles of fc − actual (MW)">
          <table className="data">
            <thead>
              <tr>
                <th>Bucket</th>
                <th>P10</th>
                <th>P50</th>
                <th>P90</th>
                <th>MAE</th>
              </tr>
            </thead>
            <tbody>
              {data.by_lead.map((row) => (
                <tr key={row.bucket}>
                  <td>{row.label}</td>
                  <td>{data.bands[row.bucket]?.p10 ?? "—"}</td>
                  <td>{data.bands[row.bucket]?.p50 ?? "—"}</td>
                  <td>{data.bands[row.bucket]?.p90 ?? "—"}</td>
                  <td>{row.mae_mw?.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-[#86868B]">
            Use these bands as the forecast uncertainty envelope in the decision view.
          </p>
        </ChartCard>

        <ChartCard title="Most extreme half-hours of January" hint="|forecast − actual| ranking">
          <div className="max-h-64 overflow-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Delivery slot (UTC)</th>
                  <th>Forecast</th>
                  <th>Actual</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {data.worst_slots.map((s) => (
                  <tr key={s.t}>
                    <td>{s.t.replace("T", " ")}</td>
                    <td>{s.forecast_mw.toLocaleString()}</td>
                    <td>{s.actual_mw.toLocaleString()}</td>
                    <td className={s.error_mw > 0 ? "text-[#D70015]" : "text-[#0E7490]"}>
                      {(s.error_mw > 0 ? "+" : "") + s.error_mw.toLocaleString()} MW
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>
      </div>

      <ChartCard
        title="Bias by time of day"
        hint="average fc − actual per half-hour slot (MW)"
      >
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.slot_profile}>
              <CartesianGrid stroke="#E5E5EA" vertical={false} />
              <XAxis
                dataKey="time"
                tick={{ fill: "#6E6E73", fontSize: 10 }}
                interval={5}
              />
              <YAxis tick={{ fill: "#6E6E73", fontSize: 11 }} width={55} />
              <Tooltip
                labelFormatter={(t, payload) =>
                  `${t} · MAE ${(payload?.[0] as { mae_mw?: number } | undefined)?.mae_mw ?? "—"} MW`
                }
                formatter={(v: any) => [`${v.toFixed(0)} MW`, "mean error"]}
              />
              <ReferenceLine y={0} stroke="#AEAEB2" />
              <Bar isAnimationActive={false} dataKey="mean_error_mw" name="mean error">
                {data.slot_profile.map((s) => (
                  <Cell key={s.slot} fill={s.mean_error_mw >= 0 ? "rgba(255,59,48,0.75)" : "rgba(50,173,230,0.75)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    </div>
  );
}
