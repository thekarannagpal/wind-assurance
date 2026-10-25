export interface SlotRow {
  t: string;
  actual: number | null;
  decision_forecast: number | null;
  latest_forecast: number | null;
  persistence: number | null;
  lead_hours: number | null;
}

interface Metrics {
  n: number;
  mae_mw: number;
  rmse_mw: number;
  bias_mw: number;
  wape: number | null;
  mape: number | null;
  mean_actual_mw: number;
}

export interface DayDetail {
  day: string;
  cutoff: {
    lead_hours: number;
    publish_time: string;
    bucket: string;
    mean_effective_lead_hours: number;
  };
  slots: SlotRow[];
  metrics: {
    decision: Metrics | null;
    latest: Metrics | null;
    persistence: Metrics | null;
    skill_vs_persistence: number | null;
  };
  procurement: {
    planned_wind_gwh: number;
    achieved_wind_gwh: number;
    energy_gap_gwh: number;
    shortfall_gwh: number;
    untracked_surplus_gwh: number;
    largest_halfhour_gap_mw: number;
    largest_halfhour_gap_ts: string | null;
  } | null;
  runs_available: { publish_time: string; points: number; lead_hours_at_day_start: number }[];
  later_revisions: string[];
  band: Record<string, { label?: string; p10?: number; p50?: number; p90?: number }>;
}

export interface LeadRow extends Partial<Metrics> {
  bucket: string;
  label: string;
}

export interface MonthlySummary {
  month: string;
  lead_hours: number;
  kpi: {
    planned_wind_gwh: number;
    achieved_wind_gwh: number;
    shortfall_gwh: number;
    untracked_surplus_gwh: number;
    mae_mw: number | null;
    wape: number | null;
    bias_mw: number | null;
    n_slots: number;
    skill_vs_persistence: number | null;
    days_under_forecast: number;
    days_over_forecast: number;
  };
  daily: {
    day: string;
    planned_wind_gwh: number;
    achieved_wind_gwh: number;
    energy_gap_gwh: number;
    mae_mw: number | null;
    bias_mw: number | null;
    n_slots: number;
  }[];
  by_lead: LeadRow[];
  slot_profile: { slot: number; time: string; mean_error_mw: number; mae_mw: number }[];
  worst_days: MonthlySummary["daily"];
}

export interface AccuracyPage {
  month: string;
  lead_hours: number;
  by_lead: LeadRow[];
  slot_profile: MonthlySummary["slot_profile"];
  kpi: MonthlySummary["kpi"];
  bands: Record<string, { label?: string; p10?: number; p50?: number; p90?: number }>;
  scatter: { actual_mw: number; forecast_mw: number; day: string }[];
  worst_slots: { t: string; actual_mw: number; forecast_mw: number; error_mw: number }[];
}

export interface DayRow {
  day: string;
  mean_wind_mw: number | null;
  energy_gap_gwh: number | null;
  runs_before_cutoff: number;
  later_revisions: number;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  summary: (leadHours: number) => get<MonthlySummary>(`/api/summary?lead_hours=${leadHours}`),
  day: (day: string, leadHours: number) => get<DayDetail>(`/api/day/${day}?lead_hours=${leadHours}`),
  accuracy: (leadHours: number) => get<AccuracyPage>(`/api/accuracy?lead_hours=${leadHours}`),
  days: () => get<DayRow[]>("/api/days"),
  dataStatus: () => get<{ ingested_at: string | null }>("/api/data-status"),
};
