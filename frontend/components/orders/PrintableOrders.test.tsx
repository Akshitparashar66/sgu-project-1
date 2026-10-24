import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EvacuationOrder } from "@/lib/api/client";
import type { ScenarioConfig } from "@/lib/schemas/types";
import { OrderSheet, PrintOrdersDialog } from "./PrintableOrders";

const scenario = {
  name: "Hindon River Flood",
  zones: [{ id: "Z1", name: "Hindon Riverside, Sihani" }],
  shelters: [{ id: "S1", name: "North RNE School Camp" }],
} as unknown as ScenarioConfig;
const orders: EvacuationOrder[] = [
  { zoneId: "Z1", movementProfile: "reduced_mobility", people: 120, shelterId: "S1", routeEdgeIds: ["E1", "E2"], departureMinute: 0 },
  { zoneId: "Z1", movementProfile: "standard", people: 480, shelterId: "S1", routeEdgeIds: ["E1", "E2"], departureMinute: 5 },
];
const interventions = { openedShelters: [{ shelterId: "S4", name: "Indoor Hall" }], marshalledRoads: ["E4"] };

describe("OrderSheet", () => {
  it("prints the orders wave by wave in English, with what to open and where to post marshals", () => {
    render(<OrderSheet orders={orders} interventions={interventions} scenario={scenario} clearanceMinutes={37.5} language="en" prepared="24 Oct" />);

    expect(screen.getByRole("heading", { name: "Leave at: Now" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Leave at: +5 min" })).toBeInTheDocument();
    expect(screen.getByText("Hindon Riverside, Sihani (slower walkers)")).toBeInTheDocument();
    expect(screen.getByText(/600 people in total/)).toBeInTheDocument();
    expect(screen.getByText(/about 37.5 minutes/)).toBeInTheDocument();
    expect(screen.getByText("Indoor Hall")).toBeInTheDocument();
    expect(screen.getByText(/Not a live emergency instruction/)).toBeInTheDocument();
  });

  it("prints the same sheet in Hindi, keeping place names as they are", () => {
    render(<OrderSheet orders={orders} interventions={interventions} scenario={scenario} clearanceMinutes={37.5} language="hi" prepared="24 Oct" />);

    expect(screen.getByRole("heading", { name: "निकासी आदेश" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "निकलने का समय: अभी" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "निकलने का समय: +5 मिनट" })).toBeInTheDocument();
    expect(screen.getByText("Hindon Riverside, Sihani (धीमे चलने वाले)")).toBeInTheDocument();
    expect(screen.getByText(/कुल 600 लोग/)).toBeInTheDocument();
  });
});

describe("PrintOrdersDialog", () => {
  it("switches language and prints", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<PrintOrdersDialog orders={orders} scenario={scenario} clearanceMinutes={null} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "हिन्दी" }));
    expect(screen.getByRole("heading", { name: "निकासी आदेश" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /प्रिंट करें/ }));
    expect(print).toHaveBeenCalled();
  });
});
