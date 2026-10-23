import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RunResult, ScenarioConfig } from "@/lib/schemas/types";
import { Inspector } from "./Inspector";

const scenario: ScenarioConfig = {
  id: "s", name: "s", description: "", synthetic: true,
  nodes: [{ id: "N3", lat: 0, lon: 0, label: "Hazard-adjacent junction" }, { id: "N4", lat: 0, lon: 0, label: "Shelter S1 connector" }],
  edges: [{ id: "E3", source: "N3", target: "N4", lengthM: 500, capacityPerTick: 20, baseTravelTimeS: 60, status: "open", hazardRisk: 0.1 }],
  zones: [{ id: "Z1", name: "Riverside Colony", connectorNode: "N3", evacueeCount: 300, movementProfile: { standard: 0.8, reduced_mobility: 0.2 } }],
  shelters: [{ id: "S1", name: "Highland School", connectorNode: "N4", totalCapacity: 250, occupied: 0, available: true }],
  hazards: [],
  defaultParams: { tickSeconds: 30, maxTicks: 240, randomSeed: 42 },
};

const run: RunResult = {
  runId: "r", scenarioId: "s", planLabel: "baseline", randomSeed: 42,
  metrics: { evacuatedCount: 2, unservedCount: 0, completionTick: 5, hitTickLimit: false, maxCongestionRatio: 6.6, runtimeMs: 1 },
  agents: [
    { id: "a", originZone: "Z1", assignedShelter: "S1", routeEdgeIds: ["E3"], status: "arrived", arrivalTick: 5, movementProfile: "standard" },
    { id: "b", originZone: "Z1", assignedShelter: "S1", routeEdgeIds: ["E3"], status: "arrived", arrivalTick: 5, movementProfile: "standard" },
  ],
  shelters: [{ shelterId: "S1", totalCapacity: 250, finalOccupied: 2, rejectedCount: 0 }],
  congestion: [{ edgeId: "E3", peakDemandToCapacity: 6.6, peakTick: 13, totalDelayS: 88065 }],
  warnings: [],
};

describe("Inspector", () => {
  it("shows a road's details and run congestion, and closes it on request (PRD §4.2.D)", () => {
    const onToggleEdge = vi.fn();
    render(<Inspector scenario={scenario} selection={{ kind: "edge", id: "E3" }} run={run}
                      onToggleEdge={onToggleEdge} onToggleShelter={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: /Road E3/ })).toBeInTheDocument();
    expect(screen.getByText("Hazard-adjacent junction → Shelter S1 connector")).toBeInTheDocument();
    expect(screen.getByText("6.60× at tick 13")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // agents routed over E3

    fireEvent.click(screen.getByRole("button", { name: "Close road" }));
    expect(onToggleEdge).toHaveBeenCalledWith("E3");
  });

  it("offers to reopen a closed road", () => {
    const closed = { ...scenario, edges: [{ ...scenario.edges[0], status: "closed" as const }] };
    render(<Inspector scenario={closed} selection={{ kind: "edge", id: "E3" }} run={null}
                      onToggleEdge={vi.fn()} onToggleShelter={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Reopen road" })).toBeInTheDocument();
  });

  it("shows shelter occupancy from the run and toggles availability", () => {
    const onToggleShelter = vi.fn();
    render(<Inspector scenario={scenario} selection={{ kind: "shelter", id: "S1" }} run={run}
                      onToggleEdge={vi.fn()} onToggleShelter={onToggleShelter} onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: /Highland School/ })).toBeInTheDocument();
    expect(screen.getByText("2 / 250 (1%)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mark unavailable" }));
    expect(onToggleShelter).toHaveBeenCalledWith("S1");
  });

  it("shows a zone's population mix and where its evacuees went", () => {
    render(<Inspector scenario={scenario} selection={{ kind: "zone", id: "Z1" }} run={run}
                      onToggleEdge={vi.fn()} onToggleShelter={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: /Riverside Colony/ })).toBeInTheDocument();
    expect(screen.getByText("reduced mobility 20%")).toBeInTheDocument();
    expect(screen.getByText("S1: 2")).toBeInTheDocument();
  });

  it("renders nothing without a selection", () => {
    const { container } = render(<Inspector scenario={scenario} selection={null} run={null}
                                            onToggleEdge={vi.fn()} onToggleShelter={vi.fn()} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
