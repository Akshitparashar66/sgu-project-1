import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ScenarioConfig } from "@/lib/schemas/types";
import { EvacuationOrders } from "./ComparisonView";

const scenario = {
  nodes: [{ id: "N1", label: "Sihani" }, { id: "N2", label: "Central" }, { id: "N4", label: "North" }],
  edges: [{ id: "E1", source: "N1", target: "N2" }, { id: "E3", source: "N4", target: "N2" }],
  zones: [{ id: "Z1", name: "Hindon Riverside", connectorNode: "N1" }],
  shelters: [{ id: "S1", name: "North RNE School Camp" }],
} as unknown as ScenarioConfig;

describe("EvacuationOrders", () => {
  it("groups the plan into departure waves, each summarised and listing who goes where by which roads", () => {
    const { container } = render(
      <EvacuationOrders
        scenario={scenario}
        orders={[
          { zoneId: "Z1", movementProfile: "reduced_mobility", people: 60, shelterId: "S1", routeEdgeIds: ["E1", "E3"], departureMinute: 10 },
          { zoneId: "Z1", movementProfile: "standard", people: 240, shelterId: "S1", routeEdgeIds: ["E1", "E3"], departureMinute: 0 },
        ]}
      />,
    );

    const waves = container.querySelectorAll("details");
    expect(waves).toHaveLength(2);
    expect(waves[0]).toHaveAttribute("open");
    expect(waves[1]).not.toHaveAttribute("open");
    expect(within(waves[0] as HTMLElement).getByText("Now")).toBeInTheDocument();
    expect(waves[0]).toHaveTextContent("240 people");
    expect(waves[1]).toHaveTextContent("+10 min · 60 people · Hindon Riverside 60");
    const later = within(screen.getByRole("table", { name: "Leaving +10 min", hidden: true }));
    expect(later.getByText(/reduced mobility/)).toBeInTheDocument();
    expect(later.getByText("E1 → E3")).toHaveAttribute("title", "E1 to Central; E3 to North");
  });
});
