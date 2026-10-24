import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AlertsProvider } from "@/lib/alerts/AlertsContext";
import { liveAlert, overview } from "@/lib/alerts/testAlerts";
import type { ScenarioConfig } from "@/lib/schemas/types";
import { AlertBanner } from "./AlertBanner";

const api = { fetchAlerts: vi.fn(), acknowledgeAlert: vi.fn() };
vi.mock("@/lib/api/client", () => ({
  fetchAlerts: (...a: unknown[]) => api.fetchAlerts(...a),
  acknowledgeAlert: (...a: unknown[]) => api.acknowledgeAlert(...a),
}));

const scenario = { id: "scenario_a_normal", edges: [{ id: "E1" }, { id: "E4" }] } as unknown as ScenarioConfig;
const jam = liveAlert({
  id: "demo:traffic-nh9-bypass", severity: "severe", isDemo: true, title: "DEMO · NH-9 Bypass jammed", edgeIds: ["E1", "E4"],
  action: { label: "Set E1, E4 to 25% capacity", edgeCapacityFactors: { E1: 0.25, E4: 0.25 } },
});

function renderBanner(onApply = vi.fn()) {
  render(
    <AlertsProvider>
      <AlertBanner scenario={scenario} onApply={onApply} onOpenAlerts={vi.fn()} />
    </AlertsProvider>
  );
  return onApply;
}

describe("AlertBanner", () => {
  beforeEach(() => Object.values(api).forEach((f) => f.mockReset()));

  it("shows the most serious open alert, marked DEMO, and applies it on request", async () => {
    api.fetchAlerts.mockResolvedValue(overview({ alerts: [liveAlert({ id: "w", title: "minor" }), jam] }));
    const onApply = renderBanner();

    const banner = await screen.findByRole("alert", { name: "severe alert" });
    expect(banner).toHaveTextContent("NH-9 Bypass jammed");
    expect(banner).toHaveTextContent("Demo");
    expect(screen.getByRole("button", { name: "All alerts (2)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Apply: Set E1, E4 to 25% capacity/ }));
    expect(onApply).toHaveBeenCalledWith(jam);
  });

  it("acknowledging asks for a name and refreshes", async () => {
    api.fetchAlerts.mockResolvedValue(overview({ alerts: [jam] }));
    api.acknowledgeAlert.mockResolvedValue({ ...jam, status: "acknowledged" });
    renderBanner();

    fireEvent.click(await screen.findByRole("button", { name: "Acknowledge" }));
    const confirm = screen.getByRole("button", { name: /Confirm/ });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Control room" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(api.acknowledgeAlert).toHaveBeenCalledWith(jam.id, "Control room", ""));
    await waitFor(() => expect(api.fetchAlerts).toHaveBeenCalledTimes(2));
  });

  it("says when live data stopped arriving instead of showing old alerts as current", async () => {
    api.fetchAlerts.mockRejectedValue(new Error("Cannot reach the AEGIS backend"));
    renderBanner();
    expect(await screen.findByRole("status")).toHaveTextContent(/Live data unavailable since/);
  });

  it("shows nothing for information-only alerts", async () => {
    api.fetchAlerts.mockResolvedValue(overview({ alerts: [liveAlert({ severity: "info" })] }));
    renderBanner();
    await waitFor(() => expect(api.fetchAlerts).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
