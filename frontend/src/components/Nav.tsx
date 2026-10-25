import { NavLink, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { api } from "../lib/api";
import { useEffect, useState } from "react";

const tabs = [
  { to: "/", label: "Overview", end: true },
  { to: "/day", label: "Decision view", end: true },
  { to: "/accuracy", label: "Forecast accuracy", end: true },
];

function Seg({ day }: { day?: string }) {
  const { pathname } = useLocation();
  const isActive = (to: string, end: boolean) =>
    !end ? pathname.startsWith(to) : pathname === to || (to !== "/" && pathname === to);
  return (
    <nav className="seg" aria-label="Primary">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={day && t.to === "/day" ? `/day/${day}` : t.to}
          className={() => (isActive(t.to, t.end) || (t.to === "/day" && pathname.startsWith("/day")) ? "active" : "")}
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}

export default function Nav() {
  const { data: status } = useQuery({
    queryKey: ["dataStatus"],
    queryFn: api.dataStatus,
    staleTime: 5 * 60_000,
  });
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className="site-nav fixed inset-x-0 top-0 z-40"
      style={{
        background: "rgba(255,255,255,0.72)",
        backdropFilter: "saturate(180%) blur(22px)",
        WebkitBackdropFilter: "saturate(180%) blur(22px)",
        borderBottom: scrolled
          ? "1px solid rgba(0,0,0,0.1)"
          : "1px solid transparent",
        transition: "border-color 200ms ease",
      }}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-5">
        <div className="flex items-center gap-3">
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-[-0.01em] text-[#1d1d1f]">
              Wind Assurance
            </div>
            <div className="text-[11px] text-[#86868b]">GB day-ahead wind · January 2026</div>
          </div>
        </div>
        <Seg />
        <div className="hidden text-right text-[11px] leading-tight text-[#86868b] sm:block">
          Elexon BMRS
          <br />
          {status?.ingested_at ? `data as of ${status.ingested_at.slice(0, 10)}` : "…"}
        </div>
      </div>
    </header>
  );
}
