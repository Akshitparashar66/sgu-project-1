import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Shelter } from "@/lib/schemas/types";
import { ShelterMeters } from "./ShelterMeters";

const shelters: Shelter[] = [
  { id: "S1", name: "Highland School", connectorNode: "N4", totalCapacity: 250, occupied: 0, available: true },
  { id: "S2", name: "Community Hall", connectorNode: "N6", totalCapacity: 300, occupied: 0, available: false },
];

describe("ShelterMeters", () => {
  it("renders an accessible meter per shelter with its live occupancy", () => {
    render(<ShelterMeters shelters={shelters} occupancy={{ S1: 200 }} />);

    const meters = screen.getAllByRole("meter");
    expect(meters).toHaveLength(2);
    expect(meters[0]).toHaveAttribute("aria-valuenow", "200");
    expect(meters[0]).toHaveAttribute("aria-valuemax", "250");
    expect(screen.getByText("200 / 250")).toBeInTheDocument();
    expect(screen.getByText("unavailable")).toBeInTheDocument();
  });
});
