import type { ReactNode } from "react";

export function Kpi({
  label,
  value,
  unit,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  tone?: "default" | "bad" | "good" | "warn";
}) {
  const toneCls =
    tone === "bad"
      ? "text-[#D70015]"
      : tone === "good"
        ? "text-[#248A3D]"
        : tone === "warn"
          ? "text-[#C93400]"
          : "text-[#1D1D1F]";
  return (
    <div className="card">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value mt-1 whitespace-nowrap ${toneCls}`}>
        {value}
        {unit && <span className="kpi-unit">{unit}</span>}
      </div>
      {sub && <div className="mt-1 text-xs text-[#86868b]">{sub}</div>}
    </div>
  );
}

export function ChartCard({
  title,
  hint,
  children,
  className = "",
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`card ${className}`}>
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h3 className="chart-title">{title}</h3>
        {hint && <span className="chart-hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex h-40 items-center justify-center text-sm text-[#86868b]">
      {label}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="card border-[#ffd4d1] bg-[#fff2f1] text-sm text-[#d70015]">
      {message}
    </div>
  );
}

export function fmtPct(x: number | null | undefined, digits = 1): string {
  return x == null ? "—" : `${(x * 100).toFixed(digits)}%`;
}

export function fmtNum(x: number | null | undefined, digits = 0): string {
  return x == null
    ? "—"
    : x.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function fmtMw(x: number | null | undefined, digits = 0): string {
  return x == null ? "—" : `${fmtNum(x, digits)} MW`;
}

export function fmtGwh(x: number | null | undefined, digits = 1): string {
  return x == null ? "—" : `${fmtNum(x, digits)} GWh`;
}
