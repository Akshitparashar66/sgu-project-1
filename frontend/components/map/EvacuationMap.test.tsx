import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ScenarioConfig } from "@/lib/schemas/types";
import { EvacuationMap } from "./EvacuationMap";

type MockLayerProps = { pathOptions?: { color?: string }; children?: ReactNode };

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: ReactNode }) => <div data-testid="map-container">{children}</div>,
  TileLayer: () => <div data-testid="tile-layer" />,
  Polyline: (props: MockLayerProps) => <div data-testid="polyline" data-color={props.pathOptions?.color} />,
  Polygon: () => <div data-testid="polygon" />,
  CircleMarker: (props: MockLayerProps) => <div data-testid="circle-marker" data-color={props.pathOptions?.color}>{props.children}</div>,
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  useMap: () => ({ invalidateSize: vi.fn(), fitBounds: vi.fn(), getContainer: () => document.createElement("div") }),
}));

// jsdom has no ResizeObserver; FitToBounds only needs observe/disconnect to exist.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

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

  it("renders a labeled marker per population zone", () => {
    const scenario = buildScenario();
    scenario.zones = [{ id: "Z1", name: "Riverside", connectorNode: "N1", evacueeCount: 300, movementProfile: { standard: 1 } }];

    render(<EvacuationMap scenario={scenario} />);

    expect(screen.getAllByTestId("circle-marker")).toHaveLength(2); // 1 shelter + 1 zone
    expect(screen.getByText(/Riverside · 300 evacuees/)).toBeInTheDocument();
  });

  it("renders the legend as part of the map", () => {
    render(<EvacuationMap scenario={buildScenario()} />);
    expect(screen.getByRole("list", { name: "Map legend" })).toBeInTheDocument();
  });
});
