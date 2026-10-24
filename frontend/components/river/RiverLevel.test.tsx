import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RiverGauge, RiverStatus } from "@/lib/api/client";
import type { AegisActions } from "@/lib/state/useAegis";
import { RiverLevel } from "./RiverLevel";

const api = { fetchRiverStatus: vi.fn(), addRiverReading: vi.fn(), setRiverThresholds: vi.fn() };
vi.mock("@/lib/api/client", () => ({
  fetchRiverStatus: (...a: unknown[]) => api.fetchRiverStatus(...a),
  addRiverReading: (...a: unknown[]) => api.addRiverReading(...a),
  setRiverThresholds: (...a: unknown[]) => api.setRiverThresholds(...a),
}));

const gauge: RiverGauge = {
  id: "hindon", name: "Hindon, Ghaziabad", river: "Hindon", readingSource: "Enter from CWC.",
  warningLevelM: null, dangerLevelM: null, latest: null, recent: [], status: "no reading", suggestion: null,
};
const status = (g: Partial<RiverGauge>): RiverStatus => ({ gauges: [{ ...gauge, ...g }], feedConnected: false, feedError: null });

describe("RiverLevel", () => {
  it("records a reading and, at warning level, offers the flood scenario", async () => {
    api.fetchRiverStatus.mockResolvedValue(status({ warningLevelM: 205, dangerLevelM: 206 }));
    api.addRiverReading.mockResolvedValue(status({
      warningLevelM: 205, dangerLevelM: 206, status: "warning",
      latest: { levelM: 205.4, observedAt: "2026-10-24T06:00:00Z", source: "manual" },
      suggestion: { scenarioId: "scenario_d_hindon_flood", message: "The Hindon is at warning level." },
    }));
    const actions = { loadScenario: vi.fn() } as unknown as AegisActions;
    render(<RiverLevel actions={actions} />);

    fireEvent.change(await screen.findByLabelText("Reading (m)"), { target: { value: "205.4" } });
    fireEvent.click(screen.getByRole("button", { name: "Record" }));

    expect(await screen.findByText("warning")).toBeInTheDocument();
    expect(api.addRiverReading).toHaveBeenCalledWith("hindon", 205.4);
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));
    expect(actions.loadScenario).toHaveBeenCalledWith("scenario_d_hindon_flood");
  });

  it("asks for the district's thresholds instead of guessing them", async () => {
    api.fetchRiverStatus.mockResolvedValue(status({}));
    api.setRiverThresholds.mockResolvedValue(status({ warningLevelM: 205, dangerLevelM: 206 }));
    render(<RiverLevel actions={{} as AegisActions} />);

    fireEvent.change(await screen.findByLabelText("Warning"), { target: { value: "205" } });
    fireEvent.change(screen.getByLabelText("Danger"), { target: { value: "206" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.setRiverThresholds).toHaveBeenCalledWith("hindon", 205, 206));
    expect(screen.getByText(/doesn.t guess flood levels/)).toBeInTheDocument();
  });
});
