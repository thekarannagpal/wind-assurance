import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { api } from "../lib/api";
import { ChartCard, Kpi, Loading, ErrorState, fmtGwh, fmtMw, fmtPct, fmtNum } from "../components/ui";

const DEFAULT_LEAD = 14.5;

export default function Overview() {
  const { data, error, isLoading } = useQuery({
    queryKey: ["summary", DEFAULT_LEAD],
    queryFn: () => api.summary(DEFAULT_LEAD),
  });

  const { data: days } = useQuery({ queryKey: ["days"], queryFn: api.days });

  if (isLoading) return <Loading label="Loading January 2026 analysis…" />;
  if (error || !data) return <ErrorState message={String(error)} />;
  const k = data.kpi;

  const dailyData = data.daily.map((d) => ({
    ...d,
    label: d.day.slice(8), // day-of-month
    planned: +d.planned_wind_gwh.toFixed(1),
    achieved: +d.achieved_wind_gwh.toFixed(1),
    gap: +d.energy_gap_gwh.toFixed(1),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Day-ahead decision review — {data.month}</h1>
        <p className="section-sub mt-2 max-w-3xl">
          Day-ahead wind forecasts at the standard decision point (forecast runs published
          by 09:30 on D-1, the GB day-ahead auction gate closure) versus achieved wind
          generation. Quantified error is what helps you size the thermal hedge
          responsibly.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="Wind planned (day-ahead)"
          value={fmtNum(k.planned_wind_gwh, 1)}
          unit="GWh"
          sub={`vs achieved ${fmtGwh(k.achieved_wind_gwh)}`}
        />
        <Kpi
          label="MAE vs achieved"
          value={fmtNum(k.mae_mw, 0)}
          unit="MW"
          sub={`WAPE ${fmtPct(k.wape)} · forecast bias ${fmtMw(k.bias_mw)}`}
          tone="warn"
        />
        <Kpi
          label="Skill vs persistence"
          value={k.skill_vs_persistence == null ? "—" : `${(k.skill_vs_persistence * 100).toFixed(0)}%`}
          sub="error improvement over yesterday's wind"
        />
        <Kpi
          label="Unplanned shortfall"
          value={fmtNum(k.shortfall_gwh, 1)}
          unit="GWh"
          sub="bought on top of forecast"
          tone="bad"
        />
        <Kpi
          label="Untracked surplus"
          value={fmtNum(k.untracked_surplus_gwh, 1)}
          unit="GWh"
          sub="procured more than landed"
        />
        <Kpi
          label="Days missed"
          value={`${k.days_under_forecast}/${data.daily.length}`}
          sub="delivered less wind than forecast"
          tone="bad"
        />
      </div>

      <ChartCard
        title="Planned vs achieved wind energy per delivery day"
        hint="GWh · decision forecast at gate closure vs actual"
      >
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dailyData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid stroke="#E5E5EA" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "#6E6E73", fontSize: 11 }} />
              <YAxis tick={{ fill: "#6E6E73", fontSize: 11 }} width={40} />
              <Tooltip
                formatter={(v: any, name) => [`${v} GWh`, name]}
                labelFormatter={(l) => `January ${l}, 2026`}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar isAnimationActive={false} dataKey="planned" name="Planned (forecast)" fill="#007AFF" />
              <Bar isAnimationActive={false} dataKey="achieved" name="Achieved (actual)" fill="#34C759" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Daily energy gap"
          hint="achieved − planned (GWh) · negative = shortfall"
        >
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid stroke="#E5E5EA" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#6E6E73", fontSize: 11 }} />
                <YAxis tick={{ fill: "#6E6E73", fontSize: 11 }} width={50} />
                <Tooltip
                  formatter={(v: any) => [`${v} GWh`, "gap"]}
                  labelFormatter={(l) => `January ${l}, 2026`}
                />
                <ReferenceLine y={0} stroke="#AEAEB2" />
                <Bar isAnimationActive={false} dataKey="gap" name="Gap">
                  {dailyData.map((d) => (
                    <Cell key={d.label} fill={d.gap >= 0 ? "#32ADE6" : "#FF3B30"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard
          title="Half-hour error shape across the month"
          hint="mean forecast error by slot of day (MW)"
        >
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.slot_profile}>
                <CartesianGrid stroke="#E5E5EA" vertical={false} />
                <XAxis
                  dataKey="time"
                  tick={{ fill: "#6E6E73", fontSize: 10 }}
                  tickFormatter={(t: string, i: number) => (i % 4 === 0 ? t : "")}
                  interval={0}
                />
                <YAxis tick={{ fill: "#6E6E73", fontSize: 11 }} width={55} />
                <Tooltip formatter={(v: any) => [`${v.toFixed(0)} MW`, "mean error"]} />
                <ReferenceLine y={0} stroke="#AEAEB2" />
                <Line isAnimationActive={false} type="monotone" dataKey="mean_error_mw" stroke="#FF9500" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Worst days of January" hint="ordered by |energy gap|">
          <table className="data">
            <thead>
              <tr>
                <th>Day</th>
                <th>Planned</th>
                <th>Achieved</th>
                <th>Gap</th>
                <th>MAE</th>
              </tr>
            </thead>
            <tbody>
              {data.worst_days.map((d) => (
                <tr key={d.day}>
                  <td>
                    <Link to={`/day/${d.day}`} className="text-[#0066CC] hover:underline">
                      {d.day}
                    </Link>
                  </td>
                  <td>{d.planned_wind_gwh.toFixed(1)}</td>
                  <td>{d.achieved_wind_gwh.toFixed(1)}</td>
                  <td className={d.energy_gap_gwh >= 0 ? "text-[#248A3D]" : "text-[#D70015]"}>
                    {d.energy_gap_gwh.toFixed(1)} GWh
                  </td>
                  <td>{d.mae_mw?.toLocaleString()} MW</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ChartCard>

        <ChartCard title="Error by forecast lead time" hint="bucketed by hours ahead of delivery">
          <table className="data">
            <thead>
              <tr>
                <th>Bucket</th>
                <th>MAE</th>
                <th>RMSE</th>
                <th>Bias</th>
                <th>WAPE</th>
                <th>n</th>
              </tr>
            </thead>
            <tbody>
              {data.by_lead.map((r) => (
                <tr key={r.bucket}>
                  <td>{r.label}</td>
                  <td>{r.mae_mw?.toLocaleString()} MW</td>
                  <td>{r.rmse_mw?.toLocaleString()} MW</td>
                  <td>
                    {(r.bias_mw != null && r.bias_mw > 0 ? "+" : "") + fmtNum(r.bias_mw, 1)} MW
                  </td>
                  <td>{fmtPct(r.wape)}</td>
                  <td>{r.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Link
            to="/accuracy"
            className="mt-3 inline-block text-xs text-[#0066CC] hover:underline"
          >
            open full accuracy explorer →
          </Link>
        </ChartCard>
      </div>

      {days && (
        <ChartCard title="Delivery-day navigator" hint="coloured by daily energy gap">
          <div className="flex flex-wrap gap-1.5">
            {days.map((d) => {
              const gap = d.energy_gap_gwh ?? 0;
              const cls =
                gap < -50
                  ? "bg-[#FFD3CF] text-[#B3261E]"
                  : gap < 0
                    ? "bg-[#FEEAE8] text-[#D70015]"
                    : gap > 0
                      ? "bg-[#D9F3E3] text-[#1B7F3B]"
                      : "bg-[#E9E9EB] text-[#3A3A3C]";
              return (
                <Link
                  key={d.day}
                  to={`/day/${d.day}`}
                  className={`chip ${cls}`}
                  title={`${d.day}: gap ${gap.toFixed(1)} GWh`}
                >
                  {d.day.slice(8)}
                </Link>
              );
            })}
          </div>
        </ChartCard>
      )}
    </div>
  );
}
