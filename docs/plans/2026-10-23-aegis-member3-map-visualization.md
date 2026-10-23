# AEGIS — Member 3: Map & Visualization Implementation Plan

> This workstream is judged by eye: check the result in the browser
> (screenshot → compare → fix) after every step, not just the automated tests below.

**Goal:** A Leaflet map rendering every PRD §4.2 layer (roads, population
zones, shelters, hazard boundary, closed roads, routes, congestion,
agents) with a legend that makes every state distinguishable without
relying on color alone (PRD §12.3).

**Architecture:** Pure styling/color-mapping functions (TDD'd with
Vitest, zero DOM) feed a `react-leaflet` component tree. The map takes a
`ScenarioConfig` and an optional `RunResult` as props — it never fetches
data itself; Member 4's dashboard owns data-fetching and passes props
down. This keeps the map a dumb, testable rendering layer.

**Tech Stack:** Next.js (App Router), React, TypeScript, Tailwind,
`react-leaflet` + `leaflet`, Vitest + React Testing Library.

**Spec:** `2026-10-23-aegis-master-plan.md` §3.2 (`types.ts` contracts, now
camelCase end-to-end — see the note there) in this folder. PRD §4.2.C (Map
layers + legend), §12.3 (Accessibility).

**Prerequisite:** the Hour-0 frontend scaffold (Next.js + TS + Tailwind +
`react-leaflet`/`leaflet`/`recharts`/`lucide-react` installed,
`frontend/lib/schemas/types.ts` committed) exists — see master plan §2.
If `react-leaflet`/`leaflet` aren't yet in `package.json`, run
`npm install react-leaflet leaflet && npm install -D @types/leaflet` first.

## Global Constraints

- Never signal state by color alone — every legend entry pairs a color
  with a label; closed roads also get a distinct dash pattern, not just a
  different color.
- The map component takes data as props; it does not call `fetch` itself.
- Keep `EvacuationMap` under ~150 lines — split a new layer into its own
  file in `components/map/layers/` the moment it grows past "one `.map()`
  over a scenario array."

---

### Task 1: Pure styling functions

**Files:**
- Create: `frontend/lib/map/styling.ts`
- Test: `frontend/lib/map/styling.test.ts`

**Interfaces:**
- Consumes: `RoadStatus`, `AgentStatus` from `@/lib/schemas/types`.
- Produces: `roadColor(status, congestionRatio) -> string`,
  `roadDashArray(status) -> string | undefined`,
  `shelterFillColor(occupied, totalCapacity) -> string`,
  `agentMarkerColor(status) -> string` — Task 2's `EvacuationMap` and
  `Legend` both import these by name.

- [ ] **Step 1: Write the failing tests**

```typescript
// frontend/lib/map/styling.test.ts
import { describe, expect, it } from "vitest";
import { agentMarkerColor, roadColor, roadDashArray, shelterFillColor } from "./styling";

describe("roadColor", () => {
  it("renders a closed road as red regardless of congestion", () => {
    expect(roadColor("closed", 0)).toBe("#ef4444");
  });

  it("renders an open, uncongested road as cyan", () => {
    expect(roadColor("open", 0.3)).toBe("#22d3ee");
  });

  it("renders an open road above capacity as amber, badly congested as red", () => {
    expect(roadColor("open", 1.2)).toBe("#f59e0b");
    expect(roadColor("open", 1.8)).toBe("#ef4444");
  });
});

describe("roadDashArray", () => {
  it("dashes closed roads, leaves open roads solid", () => {
    expect(roadDashArray("closed")).toBe("6 4");
    expect(roadDashArray("open")).toBeUndefined();
  });
});

describe("shelterFillColor", () => {
  it("colors by occupancy ratio: green < 80%, amber 80-99%, red at capacity", () => {
    expect(shelterFillColor(0, 100)).toBe("#22c55e");
    expect(shelterFillColor(85, 100)).toBe("#f59e0b");
    expect(shelterFillColor(100, 100)).toBe("#ef4444");
  });
});

describe("agentMarkerColor", () => {
  it("maps every AgentStatus to a distinct color", () => {
    const colors = new Set([
      agentMarkerColor("waiting"), agentMarkerColor("moving"),
      agentMarkerColor("delayed"), agentMarkerColor("arrived"),
      agentMarkerColor("unserved"),
    ]);
    expect(colors.size).toBe(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run lib/map/styling.test.ts`
Expected: `Cannot find module './styling'`

- [ ] **Step 3: Implement**

```typescript
// frontend/lib/map/styling.ts
import type { AgentStatus, RoadStatus } from "@/lib/schemas/types";

// Palette: cyan = normal/open, amber = warning/congested/near-capacity,
// red = danger/closed/full, green = safe/available, slate = idle/unknown.
// Keep these as the single source of truth — Legend.tsx renders this
// exact palette, so a change here must be reflected there.
export function roadColor(status: RoadStatus, congestionRatio: number): string {
  if (status === "closed") return "#ef4444";
  if (status === "restricted") return "#f59e0b";
  if (congestionRatio > 1.5) return "#ef4444";
  if (congestionRatio > 1.0) return "#f59e0b";
  return "#22d3ee";
}

export function roadDashArray(status: RoadStatus): string | undefined {
  return status === "closed" ? "6 4" : undefined;
}

export function shelterFillColor(occupied: number, totalCapacity: number): string {
  if (totalCapacity <= 0) return "#64748b";
  const ratio = occupied / totalCapacity;
  if (ratio >= 1.0) return "#ef4444";
  if (ratio >= 0.8) return "#f59e0b";
  return "#22c55e";
}

export function agentMarkerColor(status: AgentStatus): string {
  switch (status) {
    case "arrived": return "#22c55e";
    case "unserved": return "#ef4444";
    case "delayed": return "#f59e0b";
    case "moving": return "#22d3ee";
    case "waiting":
    default: return "#94a3b8";
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run lib/map/styling.test.ts`
Expected: `4 passed`

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/map/styling.ts frontend/lib/map/styling.test.ts
git commit -m "feat(map): pure color/dash mapping for roads, shelters, agents"
```

---

### Task 2: Legend component

**Files:**
- Create: `frontend/components/map/Legend.tsx`
- Test: `frontend/components/map/Legend.test.tsx`

**Interfaces:**
- Consumes: `roadColor`, `shelterFillColor`, `agentMarkerColor` (Task 1).
- Produces: `<Legend />` — Task 3's `EvacuationMap` renders it as an
  absolutely-positioned overlay.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/components/map/Legend.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Legend } from "./Legend";

describe("Legend", () => {
  it("lists every road/shelter/agent state so color is never the only signal (PRD §12.3)", () => {
    render(<Legend />);
    expect(screen.getByRole("list", { name: "Map legend" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(9);
    expect(screen.getByText("Closed road")).toBeInTheDocument();
    expect(screen.getByText("Shelter — full")).toBeInTheDocument();
    expect(screen.getByText("Agent — unserved")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run components/map/Legend.test.tsx`
Expected: `Cannot find module './Legend'`

- [ ] **Step 3: Implement**

```tsx
// frontend/components/map/Legend.tsx
import { agentMarkerColor, roadColor, shelterFillColor } from "@/lib/map/styling";

const LEGEND_ITEMS: { label: string; swatch: string; shape: "line" | "line-dashed" | "circle" }[] = [
  { label: "Open road", swatch: roadColor("open", 0), shape: "line" },
  { label: "Congested road", swatch: roadColor("open", 1.2), shape: "line" },
  { label: "Closed road", swatch: roadColor("closed", 0), shape: "line-dashed" },
  { label: "Shelter — available", swatch: shelterFillColor(0, 100), shape: "circle" },
  { label: "Shelter — near capacity", swatch: shelterFillColor(85, 100), shape: "circle" },
  { label: "Shelter — full", swatch: shelterFillColor(100, 100), shape: "circle" },
  { label: "Agent — moving", swatch: agentMarkerColor("moving"), shape: "circle" },
  { label: "Agent — arrived", swatch: agentMarkerColor("arrived"), shape: "circle" },
  { label: "Agent — unserved", swatch: agentMarkerColor("unserved"), shape: "circle" },
];

export function Legend() {
  return (
    <div
      role="list"
      aria-label="Map legend"
      className="absolute bottom-4 left-4 z-[1000] rounded-lg border border-slate-700 bg-slate-900/90 p-3 text-xs text-slate-200 backdrop-blur"
    >
      {LEGEND_ITEMS.map((item) => (
        <div role="listitem" key={item.label} className="flex items-center gap-2 py-0.5">
          <span
            aria-hidden
            className={item.shape === "circle" ? "h-3 w-3 rounded-full" : "h-0.5 w-4"}
            style={{
              backgroundColor: item.shape === "line-dashed" ? "transparent" : item.swatch,
              borderBottom: item.shape === "line-dashed" ? `2px dashed ${item.swatch}` : undefined,
            }}
          />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run components/map/Legend.test.tsx`
Expected: `1 passed`

- [ ] **Step 5: Browser visual check (not an automated test)**

Render `<Legend />` alone in the browser preview and confirm by eye: text
is readable against the dark background, the dashed swatch actually looks
dashed, and nothing overlaps. Screenshot it for the team channel.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/map/Legend.tsx frontend/components/map/Legend.test.tsx
git commit -m "feat(map): accessible legend — every state labeled, not just colored"
```

---

### Task 3: `EvacuationMap` — the real Leaflet map

**Files:**
- Create: `frontend/components/map/EvacuationMap.tsx`
- Test: `frontend/components/map/EvacuationMap.test.tsx`

**Interfaces:**
- Consumes: `ScenarioConfig`, `AgentResult` from `@/lib/schemas/types`;
  `roadColor`/`roadDashArray`/`shelterFillColor` (Task 1); `Legend`
  (Task 2).
- Produces: `<EvacuationMap scenario={...} congestionByEdgeId={...}
  agents={...} />`. Member 4's dashboard page imports this directly and is
  the only thing that calls the API and passes data in.

**Note on testing a real Leaflet map in jsdom:** `leaflet` needs real
browser layout APIs jsdom doesn't fully provide. Rather than fight that,
mock `react-leaflet`'s primitives in the unit test (verifying structure —
right number of roads/shelters rendered, right props passed) and verify
actual visual correctness (does it look right, does panning/zooming work)
in the browser against the real dev server. Both matter;
neither substitutes for the other.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/components/map/EvacuationMap.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ScenarioConfig } from "@/lib/schemas/types";
import { EvacuationMap } from "./EvacuationMap";

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children, ...props }: any) => <div data-testid="map-container" {...props}>{children}</div>,
  TileLayer: () => <div data-testid="tile-layer" />,
  Polyline: (props: any) => <div data-testid="polyline" data-color={props.pathOptions?.color} />,
  Polygon: (props: any) => <div data-testid="polygon" />,
  CircleMarker: (props: any) => <div data-testid="circle-marker" data-color={props.pathOptions?.color} />,
}));

function buildScenario(): ScenarioConfig {
  return {
    id: "s", name: "s", description: "", synthetic: true,
    nodes: [
      { id: "N1", lat: 1, lon: 1 }, { id: "N2", lat: 2, lon: 2 },
    ],
    edges: [
      { id: "E1", source: "N1", target: "N2", lengthM: 100, capacityPerTick: 10,
        baseTravelTimeS: 60, status: "open", hazardRisk: 0 },
    ],
    zones: [],
    shelters: [
      { id: "S1", name: "S1", connectorNode: "N2", totalCapacity: 50, occupied: 10, available: true },
    ],
    hazards: [
      { id: "H1", polygon: [[1, 1], [2, 1], [2, 2], [1, 2]], severity: 0.5, startTick: 0 },
    ],
    defaultParams: { tickSeconds: 30, maxTicks: 240, randomSeed: 42 },
  };
}

describe("EvacuationMap", () => {
  it("renders one Polyline per edge, one CircleMarker per shelter, and the hazard polygon", () => {
    render(<EvacuationMap scenario={buildScenario()} />);

    expect(screen.getAllByTestId("polyline")).toHaveLength(1);
    expect(screen.getAllByTestId("circle-marker")).toHaveLength(1);
    expect(screen.getByTestId("polygon")).toBeInTheDocument();
  });

  it("renders the legend as part of the map", () => {
    render(<EvacuationMap scenario={buildScenario()} />);
    expect(screen.getByRole("list", { name: "Map legend" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run components/map/EvacuationMap.test.tsx`
Expected: `Cannot find module './EvacuationMap'`

- [ ] **Step 3: Implement**

```tsx
// frontend/components/map/EvacuationMap.tsx
"use client";

import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer } from "react-leaflet";

import { agentMarkerColor, roadColor, roadDashArray, shelterFillColor } from "@/lib/map/styling";
import type { AgentResult, ScenarioConfig } from "@/lib/schemas/types";
import { Legend } from "./Legend";

interface EvacuationMapProps {
  scenario: ScenarioConfig;
  congestionByEdgeId?: Record<string, number>;
  agents?: AgentResult[];
}

export function EvacuationMap({ scenario, congestionByEdgeId = {}, agents = [] }: EvacuationMapProps) {
  const nodeById = new Map(scenario.nodes.map((n) => [n.id, n]));
  const center: [number, number] = scenario.nodes.length
    ? [scenario.nodes[0].lat, scenario.nodes[0].lon]
    : [0, 0];

  return (
    <div className="relative h-full w-full">
      <MapContainer center={center} zoom={14} className="h-full w-full">
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        {scenario.edges.map((edge) => {
          const source = nodeById.get(edge.source);
          const target = nodeById.get(edge.target);
          if (!source || !target) return null;
          const ratio = congestionByEdgeId[edge.id] ?? 0;
          return (
            <Polyline
              key={edge.id}
              positions={[[source.lat, source.lon], [target.lat, target.lon]]}
              pathOptions={{ color: roadColor(edge.status, ratio), dashArray: roadDashArray(edge.status), weight: 4 }}
            />
          );
        })}

        {scenario.hazards.map((hazard) => (
          <Polygon
            key={hazard.id}
            positions={hazard.polygon}
            pathOptions={{ color: "#ef4444", fillOpacity: 0.05 + 0.15 * hazard.severity }}
          />
        ))}

        {scenario.shelters.map((shelter) => {
          const node = nodeById.get(shelter.connectorNode);
          if (!node) return null;
          return (
            <CircleMarker
              key={shelter.id}
              center={[node.lat, node.lon]}
              radius={10}
              pathOptions={{ color: shelterFillColor(shelter.occupied, shelter.totalCapacity), fillOpacity: 0.8 }}
            />
          );
        })}

        {agents
          .filter((a) => a.status === "arrived" || a.status === "unserved")
          .map((agent) => {
            // MVP renders only resolved agents at their final position.
            // Mid-route interpolation/animation is PRD §3.2 P1 ("Animated
            // evacuation replay") — deliberately deferred, see checklist below.
            const lastEdgeId = agent.routeEdgeIds[agent.routeEdgeIds.length - 1];
            const lastEdge = scenario.edges.find((e) => e.id === lastEdgeId);
            const targetNode = lastEdge ? nodeById.get(lastEdge.target) : undefined;
            if (!targetNode) return null;
            return (
              <CircleMarker
                key={agent.id}
                center={[targetNode.lat, targetNode.lon]}
                radius={3}
                pathOptions={{ color: agentMarkerColor(agent.status), fillOpacity: 1 }}
              />
            );
          })}
      </MapContainer>
      <Legend />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run components/map/EvacuationMap.test.tsx`
Expected: `2 passed`

- [ ] **Step 5: Browser visual check**

Start the dev server, load a page rendering
`<EvacuationMap scenario={scenarioA} />` with the real
`data/scenarios/scenario_a_normal.json` fixture (master plan §4). Confirm
by eye: the tile layer loads, the hazard polygon sits roughly between N3
and N4, all 3 shelter markers are visible and colored green (nothing
occupied yet), roads render as solid cyan lines. Screenshot and compare
against the next run after Member 5's real `/api/scenarios/{id}` is wired
up (Task 4) to confirm no visual regression.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/map/EvacuationMap.tsx frontend/components/map/EvacuationMap.test.tsx
git commit -m "feat(map): render roads, hazard zone, shelters and resolved agents"
```

---

### Remaining tasks (checklist)

- [ ] **PRD §4.2.C "population origin zones" layer** — add a `ZoneLayer`
  (circle markers at each zone's `connectorNode`, sized/labeled by
  `evacueeCount`) following the exact same pattern as the shelter markers
  in Task 3. Add to the Legend too.
- [ ] **PRD §3.2 P1 "Animated evacuation replay"** — once Member 4's
  results drawer has a tick-scrubber control, extend `EvacuationMap` to
  accept a `currentTick` prop and interpolate each `MOVING`/`DELAYED`
  agent's position along its current edge (`edge_index` /
  `ticksRemainingOnEdge` aren't in `AgentResult` today — if you need them
  for smooth interpolation, propose the addition to Member 1 rather than
  guessing at the shape, since that's a shared-contract change after
  Hour 1, per master plan §6 rule 2).
- [ ] **PRD §3.2 P1 "Bottleneck highlighting"** — once `EdgeCongestionResult`
  data flows in as `congestionByEdgeId`, make badly-congested edges
  (ratio > 1.5) pulse or thicken, not just turn red, so they're visible at
  a glance on a crowded map.
- [ ] **Responsive check (PRD §4.1)** — confirm the map fills available
  height correctly when Member 4's results drawer (bottom of the page) is
  expanded vs. collapsed; this is a joint visual check with Member 4, do
  it together once both pieces exist.
- [ ] **Accessibility (PRD §12.3)** — keyboard focus should be able to
  reach the legend and any map controls; Leaflet's default zoom buttons
  are already keyboard-accessible, verify they still are after Tailwind
  styling is applied (tab through the page and screenshot
  the focus ring).
