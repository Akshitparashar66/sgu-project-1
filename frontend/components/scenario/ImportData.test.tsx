import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScenarioConfig } from "@/lib/schemas/types";
import type { AegisActions } from "@/lib/state/useAegis";
import { ImportData, templates } from "./ImportData";

const importScenario = vi.fn();
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  importScenario: (...args: unknown[]) => importScenario(...args),
}));

const scenario = {
  id: "scenario_a_normal",
  nodes: [{ id: "N1", lat: 28.7, lon: 77.41 }, { id: "N4", lat: 28.71, lon: 77.43 }],
  zones: [{ id: "Z1", name: "Sihani, ward 7", connectorNode: "N1", evacueeCount: 600, movementProfile: { standard: 0.8, reduced_mobility: 0.2 } }],
  shelters: [{ id: "S1", name: "School Camp", connectorNode: "N4", totalCapacity: 600 }],
} as unknown as ScenarioConfig;

describe("ImportData", () => {
  beforeEach(() => importScenario.mockReset());

  it("offers the scenario's own data as templates in the import format", () => {
    const csv = templates(scenario);
    expect(csv.zones).toBe('name,population,lat,lon,reduced_mobility_share\n"Sihani, ward 7",600,28.7,77.41,20\n');
    expect(csv.shelters).toBe("name,capacity,lat,lon\nSchool Camp,600,28.71,77.43\n");
  });

  it("uploads the chosen files onto this scenario's network and opens the result", async () => {
    importScenario.mockResolvedValue({
      scenarioId: "imported_pilot", warnings: ["Shelter 'X' is 2.1 km from the nearest road junction"],
      summary: { nodes: 6, edges: 7, zones: 1, shelters: 2, evacuees: 450, shelterCapacity: 1300 },
    });
    const actions = { openScenario: vi.fn() } as unknown as AegisActions;
    render(<ImportData scenario={scenario} actions={actions} />);

    fireEvent.change(screen.getByLabelText("Scenario name"), { target: { value: "Pilot" } });
    const file = new File(["name,capacity,lat,lon\nX,800,28.6,77.3\n"], "shelters.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("Shelters CSV"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Import and open" }));

    expect(await screen.findByText(/2 shelters \(1,300 places\)/)).toBeInTheDocument();
    expect(screen.getByText(/2.1 km from the nearest road junction/)).toBeInTheDocument();
    expect(importScenario).toHaveBeenCalledWith({
      baseScenarioId: "scenario_a_normal", name: "Pilot", zonesCsv: undefined, sheltersCsv: "name,capacity,lat,lon\nX,800,28.6,77.3\n",
    });
    expect(actions.openScenario).toHaveBeenCalledWith("imported_pilot");
  });

  it("can't import until a file is chosen", () => {
    render(<ImportData scenario={scenario} actions={{} as AegisActions} />);
    expect(screen.getByRole("button", { name: "Import and open" })).toBeDisabled();
  });
});
