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
  it("lists the plan wave by wave, with who leaves, where to, and the junctions on the way", () => {
    render(
      <EvacuationOrders
        scenario={scenario}
        orders={[
          { zoneId: "Z1", movementProfile: "reduced_mobility", people: 60, shelterId: "S1", routeEdgeIds: ["E1", "E3"], departureMinute: 10 },
          { zoneId: "Z1", movementProfile: "standard", people: 240, shelterId: "S1", routeEdgeIds: ["E1", "E3"], departureMinute: 0 },
        ]}
      />,
    );

    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByRole("rowheader")).toHaveTextContent("Now");
    expect(within(rows[0]).getByText("240")).toBeInTheDocument();
    expect(within(rows[1]).getByRole("rowheader")).toHaveTextContent("+10 min");
    expect(within(rows[1]).getByText(/reduced mobility/)).toBeInTheDocument();
    expect(within(rows[1]).getByText("E1 → E3")).toHaveAttribute("title", "E1 to Central; E3 to North");
  });
});
