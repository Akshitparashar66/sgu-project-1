# AEGIS — Member 4: Dashboard & UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans`.
> **Recommended tool:** Antigravity — layout and theming are judged by eye.

**Goal:** The command-center shell (sidebar, header, results drawer) from
PRD §4.2, plus the metric-formatting rules from PRD §8 that keep the
dashboard honest (never show a percentage when the baseline is zero,
always distinguish "completed" from "hit the time limit").

**Architecture:** Pure formatting functions (TDD'd, zero DOM) feed two
presentational components: `AppShell` (sidebar + header, PRD §4.2 A/B) and
`ResultsDrawer` (PRD §4.2 E). Both take data as props — same rule as
Member 3's map — so they're testable without a real API and reusable once
Member 5's live data is wired in (Task 4, checklist).

**Tech Stack:** Next.js (App Router), React, TypeScript, Tailwind,
`lucide-react`, Vitest + React Testing Library.

**Spec:** `2026-10-23-aegis-master-plan.md` §3.2 (`types.ts`, camelCase)
in this folder. PRD §4.1 (visual identity), §4.2.A/B/E (layout), §8.8
(comparison-view rules), §6.7 (completed vs. time-limit distinction).

**Prerequisite:** Hour-0 frontend scaffold exists (master plan §2).

## Global Constraints

- Navy/cyan AEGIS palette (PRD §4.1): deep navy background, cyan accent,
  amber for warnings, red for danger, green for safe/complete.
- Never show a fake "live connected" status — the synthetic-data
  indicator is a label, not a status light implying a real feed.
- Never display a percentage when the baseline value is zero or the
  calculation is undefined (PRD §8.8) — show `"n/a"` instead.
- The results drawer must be collapsible, not a fixed overlay that
  permanently covers the map on small screens (PRD §4.2.E).

---

### Task 1: Metric formatting functions

**Files:**
- Create: `frontend/lib/metrics/format.ts`
- Test: `frontend/lib/metrics/format.test.ts`

**Interfaces:**
- Consumes: `MetricComparison` from `@/lib/schemas/types`.
- Produces: `formatPercentDiff(comparison) -> string`,
  `formatImprovement(comparison) -> "improved"|"worse"|"unchanged"`,
  `formatCompletionTick(completionTick, hitTickLimit, tickSeconds) -> string`,
  `formatOccupancy(occupied, totalCapacity) -> string` — Tasks 3 and the
  checklist's comparison view both import these.

- [ ] **Step 1: Write the failing tests**

```typescript
// frontend/lib/metrics/format.test.ts
import { describe, expect, it } from "vitest";
import { formatCompletionTick, formatImprovement, formatOccupancy, formatPercentDiff } from "./format";

describe("formatPercentDiff", () => {
  it("shows n/a when percentDiff is null (baseline was zero) — PRD §8.8", () => {
    expect(formatPercentDiff({ metricName: "x", baselineValue: 0, alternativeValue: 5, absoluteDiff: 5, percentDiff: null, improved: null })).toBe("n/a");
  });

  it("formats a signed percentage otherwise", () => {
    expect(formatPercentDiff({ metricName: "x", baselineValue: 100, alternativeValue: 120, absoluteDiff: 20, percentDiff: 20, improved: true })).toBe("+20.0%");
    expect(formatPercentDiff({ metricName: "x", baselineValue: 100, alternativeValue: 80, absoluteDiff: -20, percentDiff: -20, improved: true })).toBe("-20.0%");
  });
});

describe("formatImprovement", () => {
  it("falls back to unchanged when improved is null (not meaningfully comparable)", () => {
    expect(formatImprovement({ metricName: "x", baselineValue: 0, alternativeValue: 0, absoluteDiff: 0, percentDiff: null, improved: null })).toBe("unchanged");
  });

  it("reports improved or worse otherwise", () => {
    expect(formatImprovement({ metricName: "x", baselineValue: 10, alternativeValue: 5, absoluteDiff: -5, percentDiff: -50, improved: true })).toBe("improved");
    expect(formatImprovement({ metricName: "x", baselineValue: 10, alternativeValue: 15, absoluteDiff: 5, percentDiff: 50, improved: false })).toBe("worse");
  });
});

describe("formatCompletionTick", () => {
  it("distinguishes a completed evacuation from one that hit the time limit — PRD §6.7", () => {
    expect(formatCompletionTick(null, true, 30)).toBe("Time limit reached");
    expect(formatCompletionTick(10, false, 30)).toBe("5m 0s");
  });
});

describe("formatOccupancy", () => {
  it("shows occupied/total and a percentage", () => {
    expect(formatOccupancy(85, 100)).toBe("85 / 100 (85%)");
    expect(formatOccupancy(0, 0)).toBe("0 / 0 (0%)");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run lib/metrics/format.test.ts`
Expected: `Cannot find module './format'`

- [ ] **Step 3: Implement**

```typescript
// frontend/lib/metrics/format.ts
import type { MetricComparison } from "@/lib/schemas/types";

export function formatPercentDiff(comparison: MetricComparison): string {
  if (comparison.percentDiff === null) return "n/a";
  const sign = comparison.percentDiff > 0 ? "+" : "";
  return `${sign}${comparison.percentDiff.toFixed(1)}%`;
}

export function formatImprovement(comparison: MetricComparison): "improved" | "worse" | "unchanged" {
  if (comparison.improved === null) return "unchanged";
  return comparison.improved ? "improved" : "worse";
}

export function formatCompletionTick(
  completionTick: number | null, hitTickLimit: boolean, tickSeconds: number
): string {
  if (hitTickLimit) return "Time limit reached";
  if (completionTick === null) return "n/a";
  const totalSeconds = completionTick * tickSeconds;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${seconds}s`;
}

export function formatOccupancy(occupied: number, totalCapacity: number): string {
  const pct = totalCapacity > 0 ? Math.round((occupied / totalCapacity) * 100) : 0;
  return `${occupied} / ${totalCapacity} (${pct}%)`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run lib/metrics/format.test.ts`
Expected: `6 passed`

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/metrics/format.ts frontend/lib/metrics/format.test.ts
git commit -m "feat(dashboard): metric formatting honoring PRD §8.8 undefined-percentage rule"
```

---

### Task 2: `AppShell` — sidebar + header

**Files:**
- Create: `frontend/components/layout/AppShell.tsx`
- Test: `frontend/components/layout/AppShell.test.tsx`

**Interfaces:**
- Produces: `<AppShell activeNavId scenarioName simulationStatus onReset>{children}</AppShell>`
  — the frontend's root page wraps everything in this.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/components/layout/AppShell.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

describe("AppShell", () => {
  it("marks the active nav item distinctly and shows the synthetic-data indicator (PRD §4.2)", () => {
    render(
      <AppShell activeNavId="overview" scenarioName="Normal Conditions" simulationStatus="idle" onReset={vi.fn()}>
        <div>content</div>
      </AppShell>
    );

    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Live Simulation" })).not.toHaveAttribute("aria-current");
    expect(screen.getByText(/Synthetic data/i)).toBeInTheDocument();
    expect(screen.getByText("Normal Conditions")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("idle");
  });

  it("never shows a fake 'connected' live-data status (PRD §4.2.B)", () => {
    render(
      <AppShell activeNavId="overview" scenarioName="x" simulationStatus="idle" onReset={vi.fn()}>
        <div />
      </AppShell>
    );
    expect(screen.queryByText(/connected/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run components/layout/AppShell.test.tsx`
Expected: `Cannot find module './AppShell'`

- [ ] **Step 3: Implement**

```tsx
// frontend/components/layout/AppShell.tsx
"use client";

import { BarChart3, FileText, FlaskConical, LayoutDashboard, Settings, SplitSquareHorizontal } from "lucide-react";
import type { ReactNode } from "react";

const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "live-simulation", label: "Live Simulation", icon: BarChart3 },
  { id: "scenario-lab", label: "Scenario Lab", icon: FlaskConical },
  { id: "plan-comparison", label: "Plan Comparison", icon: SplitSquareHorizontal },
  { id: "reports", label: "Reports", icon: FileText },
  { id: "settings", label: "Settings", icon: Settings },
] as const;

interface AppShellProps {
  activeNavId: (typeof NAV_ITEMS)[number]["id"];
  scenarioName: string;
  simulationStatus: "idle" | "running" | "completed" | "error";
  onReset: () => void;
  children: ReactNode;
}

export function AppShell({ activeNavId, scenarioName, simulationStatus, onReset, children }: AppShellProps) {
  return (
    <div className="flex h-screen bg-slate-950 text-slate-100">
      <nav aria-label="Primary" className="flex w-56 flex-col border-r border-slate-800 bg-slate-900 p-3">
        <div className="mb-4 px-2 text-lg font-semibold tracking-tight text-cyan-400">AEGIS</div>
        <ul className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === activeNavId;
            return (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                    isActive ? "bg-cyan-500/10 text-cyan-300" : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                  }`}
                >
                  <Icon size={16} aria-hidden />
                  {item.label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/60 px-6 py-3">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-slate-100">AEGIS</span>
            <span className="text-sm text-slate-400">{scenarioName}</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span
              role="status"
              className={`rounded-full px-2 py-0.5 ${
                simulationStatus === "completed" ? "bg-green-500/10 text-green-400"
                : simulationStatus === "running" ? "bg-cyan-500/10 text-cyan-300"
                : simulationStatus === "error" ? "bg-red-500/10 text-red-400"
                : "bg-slate-700/50 text-slate-300"
              }`}
            >
              {simulationStatus}
            </span>
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-400">
              Synthetic data — prototype, not live emergency guidance
            </span>
            <button
              type="button"
              onClick={onReset}
              className="rounded-md border border-slate-700 px-3 py-1 text-slate-300 hover:bg-slate-800"
            >
              Reset
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run components/layout/AppShell.test.tsx`
Expected: `2 passed`

- [ ] **Step 5: Antigravity visual check**

Load the shell in the browser preview with each `simulationStatus` value
and confirm the status pill's color reads clearly against the navy
background in both the default and any dark/light toggle the team ends
up shipping. Screenshot both.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/layout/AppShell.tsx frontend/components/layout/AppShell.test.tsx
git commit -m "feat(dashboard): command-center shell with sidebar, header, synthetic-data indicator"
```

---

### Task 3: `ResultsDrawer`

**Files:**
- Create: `frontend/components/metrics/ResultsDrawer.tsx`
- Test: `frontend/components/metrics/ResultsDrawer.test.tsx`

**Interfaces:**
- Consumes: `RunResult` from `@/lib/schemas/types`;
  `formatCompletionTick`/`formatOccupancy` (Task 1).
- Produces: `<ResultsDrawer result={runResultOrNull} tickSeconds={30} />`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/components/metrics/ResultsDrawer.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RunResult } from "@/lib/schemas/types";
import { ResultsDrawer } from "./ResultsDrawer";

function buildResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    runId: "r1", scenarioId: "s1", planLabel: "baseline", randomSeed: 42,
    metrics: { evacuatedCount: 700, unservedCount: 50, completionTick: 120, hitTickLimit: false, maxCongestionRatio: 1.2, runtimeMs: 10 },
    agents: [], shelters: [{ shelterId: "S1", totalCapacity: 250, finalOccupied: 250, rejectedCount: 5 }],
    congestion: [], warnings: [],
    ...overrides,
  };
}

describe("ResultsDrawer", () => {
  it("shows a placeholder message when no run has completed yet", () => {
    render(<ResultsDrawer result={null} tickSeconds={30} />);
    expect(screen.getByText(/Run a simulation/i)).toBeInTheDocument();
  });

  it("shows evacuated, unserved and shelter occupancy from a real RunResult", () => {
    render(<ResultsDrawer result={buildResult()} tickSeconds={30} />);
    expect(screen.getByText("700")).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
    expect(screen.getByText(/250 \/ 250/)).toBeInTheDocument();
    expect(screen.getByText(/5 rejected/)).toBeInTheDocument();
  });

  it("collapses without losing the underlying data", () => {
    render(<ResultsDrawer result={buildResult()} tickSeconds={30} />);
    fireEvent.click(screen.getByRole("button", { name: /Collapse/i }));
    expect(screen.getByRole("button", { name: /Expand/i })).toHaveAttribute("aria-expanded", "false");
  });

  it("surfaces a warning when the run hit the tick limit", () => {
    render(<ResultsDrawer result={buildResult({ warnings: ["Agent A1 did not resolve within max_ticks=240"] })} tickSeconds={30} />);
    expect(screen.getByRole("alert")).toHaveTextContent("1 warning");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run components/metrics/ResultsDrawer.test.tsx`
Expected: `Cannot find module './ResultsDrawer'`

- [ ] **Step 3: Implement**

```tsx
// frontend/components/metrics/ResultsDrawer.tsx
"use client";

import { useState } from "react";
import type { RunResult } from "@/lib/schemas/types";
import { formatCompletionTick, formatOccupancy } from "@/lib/metrics/format";

interface ResultsDrawerProps {
  result: RunResult | null;
  tickSeconds: number;
}

export function ResultsDrawer({ result, tickSeconds }: ResultsDrawerProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (!result) {
    return (
      <div className="border-t border-slate-800 bg-slate-900 p-4 text-sm text-slate-500">
        Run a simulation to see results here.
      </div>
    );
  }

  return (
    <div className={`border-t border-slate-800 bg-slate-900 transition-all ${collapsed ? "h-10" : "max-h-72 overflow-y-auto"}`}>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between px-4 py-2 text-sm text-slate-300"
      >
        <span>Results — {result.planLabel}</span>
        <span>{collapsed ? "Expand" : "Collapse"}</span>
      </button>

      {!collapsed && (
        <div className="grid grid-cols-2 gap-3 px-4 pb-4 sm:grid-cols-4">
          <StatTile label="Evacuated" value={result.metrics.evacuatedCount} tone="good" />
          <StatTile label="Unserved" value={result.metrics.unservedCount} tone={result.metrics.unservedCount > 0 ? "bad" : "good"} />
          <StatTile
            label="Completion"
            value={formatCompletionTick(result.metrics.completionTick, result.metrics.hitTickLimit, tickSeconds)}
            tone={result.metrics.hitTickLimit ? "warn" : "good"}
          />
          <StatTile
            label="Peak congestion"
            value={`${result.metrics.maxCongestionRatio.toFixed(2)}x`}
            tone={result.metrics.maxCongestionRatio > 1.5 ? "bad" : "good"}
          />

          <div className="col-span-2 sm:col-span-4">
            <h3 className="mb-1 text-xs uppercase tracking-wide text-slate-500">Shelter occupancy</h3>
            <ul className="flex flex-wrap gap-3 text-sm">
              {result.shelters.map((s) => (
                <li key={s.shelterId} className="rounded border border-slate-700 px-2 py-1">
                  {s.shelterId}: {formatOccupancy(s.finalOccupied, s.totalCapacity)}
                  {s.rejectedCount > 0 && <span className="ml-1 text-amber-400">({s.rejectedCount} rejected)</span>}
                </li>
              ))}
            </ul>
          </div>

          {result.warnings.length > 0 && (
            <div role="alert" className="col-span-2 text-xs text-amber-400 sm:col-span-4">
              {result.warnings.length} warning(s) — e.g. &quot;{result.warnings[0]}&quot;
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: string | number; tone: "good" | "bad" | "warn" }) {
  const toneClass = tone === "good" ? "text-green-400" : tone === "bad" ? "text-red-400" : "text-amber-400";
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run components/metrics/ResultsDrawer.test.tsx`
Expected: `4 passed`

- [ ] **Step 5: Commit**

```bash
git add frontend/components/metrics/ResultsDrawer.tsx frontend/components/metrics/ResultsDrawer.test.tsx
git commit -m "feat(dashboard): collapsible results drawer with capacity-aware shelter tiles"
```

---

### Remaining tasks (checklist)

- [ ] **Scenario controls + right Inspector panel (PRD §4.2.D)** — a
  panel that shows selected-road / selected-shelter / selected-zone
  details and a "Close road" button. This is the piece that calls
  Member 5's (checklist item, once it exists) `closeRoad`-style mutation
  — until then, stub it against a local copy of the scenario object in
  React state so the UI is demoable standalone.
- [ ] **Comparison view (PRD §4.2 nav item "Plan Comparison", §8.8)** —
  build `ComparisonTable` consuming `ComparisonResult` and
  `formatPercentDiff`/`formatImprovement` from Task 1. One row per
  `MetricComparison`, with an icon/color (not color alone — pair a ▲/▼/—
  glyph with the color) for improved/worse/unchanged.
- [ ] **Wire to Member 5's real API client** (`frontend/lib/api/client.ts`
  — see Member 5's plan) in the root page: fetch scenario list on
  mount, call `runSimulation` on "Run Simulation" click, feed the
  resulting `RunResult` into both `ResultsDrawer` (this file) and
  Member 3's `EvacuationMap`. Until Member 5's client exists, write a
  5-line local `fetch("/api/scenarios").then(r => r.json())` stand-in
  with the same function name/signature so you aren't blocked — same
  incremental-replacement pattern as the backend plans.
- [ ] **Responsive layout pass (PRD §4.1, §4.2.E)** — confirm with
  Antigravity at a laptop width (~1280px) that the results drawer's
  `max-h-72` doesn't starve the map's visible height, and that collapsing
  it restores most of the screen to the map. Do this jointly with
  Member 3 once both pieces are merged.
- [ ] **"Journey A" end-to-end click-through (PRD §5.1)** — once wired to
  real data, manually run: load default scenario → see roads/zones/
  shelters/legend → press Run Simulation → see the results drawer
  populate from the real `RunResult` → press Reset → confirm the drawer
  returns to the "Run a simulation" placeholder and the map returns to
  its pre-run state (no duplicated agents, no stale shelter fill color).
  Hand this script to Member 6 as the basis for their automated UI test.
