"use client";

import { BarChart3, FileText, FlaskConical, LayoutDashboard, RotateCcw, Settings, ShieldAlert, SplitSquareHorizontal } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

export const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "live-simulation", label: "Live Simulation", icon: BarChart3 },
  { id: "scenario-lab", label: "Scenario Lab", icon: FlaskConical },
  { id: "plan-comparison", label: "Plan Comparison", icon: SplitSquareHorizontal },
  { id: "reports", label: "Reports", icon: FileText },
  { id: "settings", label: "Settings", icon: Settings },
] as const;

export type NavId = (typeof NAV_ITEMS)[number]["id"];
export type SimulationStatus = "idle" | "running" | "completed" | "error";

interface AppShellProps {
  activeNavId: NavId;
  scenarioName: string;
  simulationStatus: SimulationStatus;
  onReset: () => void;
  /** When given, nav links switch views in place instead of following their #anchor. */
  onNavigate?: (id: NavId) => void;
  children: ReactNode;
}

const STATUS_STYLES: Record<SimulationStatus, string> = {
  completed: "bg-green-50 text-green-700",
  running: "bg-blue-50 text-blue-700",
  error: "bg-red-50 text-red-600",
  idle: "bg-slate-200 text-slate-700",
};

export function AppShell({ activeNavId, scenarioName, simulationStatus, onReset, onNavigate, children }: AppShellProps) {
  return (
    <div className="relative flex h-screen overflow-hidden bg-slate-50 text-slate-900">
      <a
        href="#main-content"
        className="sr-only z-[2000] rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to main content
      </a>
      <nav aria-label="Primary" className="flex w-16 shrink-0 flex-col border-r border-slate-200 bg-white p-2 xl:w-56 xl:p-3">
        <div className="mb-5 flex items-center gap-2 px-2 pt-1">
          <ShieldAlert size={22} className="shrink-0 text-blue-600" aria-hidden />
          <div className="sr-only xl:not-sr-only">
            <div className="text-lg font-semibold tracking-tight text-blue-600">AEGIS</div>
            <div className="text-[11px] leading-tight text-slate-500">Simulate the risk. Engineer the escape.</div>
          </div>
        </div>
        <ul className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === activeNavId;
            return (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  aria-current={isActive ? "page" : undefined}
                  title={item.label}
                  onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                    if (!onNavigate) return;
                    event.preventDefault();
                    onNavigate(item.id);
                  }}
                  className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-blue-600 ${
                    isActive ? "bg-blue-50 text-blue-700" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  <Icon size={16} aria-hidden className="shrink-0" />
                  <span className="sr-only xl:not-sr-only">{item.label}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white/80 px-4 py-3 xl:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="font-semibold text-slate-900">AEGIS</span>
            <span className="truncate text-sm text-slate-500">{scenarioName}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span role="status" className={`rounded-full px-2 py-0.5 ${STATUS_STYLES[simulationStatus]}`}>
              {simulationStatus}
            </span>
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
              Synthetic data — prototype, not live emergency guidance
            </span>
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1 text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600"
            >
              <RotateCcw size={14} aria-hidden />
              Reset
            </button>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="min-h-0 flex-1 overflow-hidden focus:outline-none">{children}</main>
      </div>
    </div>
  );
}
