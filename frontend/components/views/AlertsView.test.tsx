import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AlertsProvider } from "@/lib/alerts/AlertsContext";
import { liveAlert, overview } from "@/lib/alerts/testAlerts";
import type { ScenarioConfig } from "@/lib/schemas/types";
import { AlertsView } from "./AlertsView";

const api = {
  fetchAlerts: vi.fn(), startDemo: vi.fn(), stopDemo: vi.fn(), fetchAlertLog: vi.fn(), fetchRecipients: vi.fn(),
  fetchSendPreview: vi.fn(), sendAlert: vi.fn(), addRecipient: vi.fn(), removeRecipient: vi.fn(),
  updateAlertSettings: vi.fn(), acknowledgeAlert: vi.fn(),
};
vi.mock("@/lib/api/client", () => Object.fromEntries(
  ["fetchAlerts", "startDemo", "stopDemo", "fetchAlertLog", "fetchRecipients", "fetchSendPreview", "sendAlert", "addRecipient",
   "removeRecipient", "updateAlertSettings", "acknowledgeAlert"].map((name) => [name, (...a: unknown[]) => api[name as keyof typeof api](...a)]),
));

const scenarioG = { id: "scenario_g_detailed_network", edges: [{ id: "G1" }] } as unknown as ScenarioConfig;
const river = liveAlert({
  id: "river:hindon:danger", source: "river", severity: "severe", title: "Hindon at danger level: 206.3 m (danger level 206 m)",
  titleHi: "हिंडन नदी खतरे के स्तर पर: 206.3 मी", marksHazard: true,
  action: { label: "Open the flood scenario", scenarioId: "scenario_d_hindon_flood" },
});
const jam = liveAlert({
  id: "traffic:nh9-bypass", severity: "warning", title: "NH-9 Bypass jammed", edgeIds: ["E1", "E4"],
  action: { label: "Set E1, E4 to 50% capacity", edgeCapacityFactors: { E1: 0.5, E4: 0.5 } },
});
const ended = liveAlert({ id: "old", status: "expired", clearedReason: "condition cleared", title: "Old jam" });

function renderView(onApply = vi.fn()) {
  render(<AlertsProvider><AlertsView scenario={scenarioG} onApply={onApply} /></AlertsProvider>);
  return onApply;
}

describe("AlertsView", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    api.fetchAlertLog.mockResolvedValue([]);
    api.fetchRecipients.mockResolvedValue([]);
  });

  it("lists open alerts with both languages, and only applies what fits the loaded scenario", async () => {
    api.fetchAlerts.mockResolvedValue(overview({ alerts: [river, jam, ended] }));
    const onApply = renderView();

    const list = await screen.findByRole("region", { name: "Alert list" });
    expect(within(list).getByText(river.title)).toBeInTheDocument();
    expect(within(list).getByText("हिंडन नदी खतरे के स्तर पर: 206.3 मी")).toBeInTheDocument();
    expect(within(list).queryByText("Old jam")).not.toBeInTheDocument();

    // The detailed network (G) has no road E1/E4: the traffic what-if can't apply there.
    expect(within(list).getByRole("button", { name: /Set E1, E4 to 50% capacity/ })).toBeDisabled();
    fireEvent.click(within(list).getByRole("button", { name: /Open the flood scenario/ }));
    expect(onApply).toHaveBeenCalledWith(river);

    fireEvent.click(screen.getByRole("button", { name: "Ended (1)" }));
    expect(within(list).getByText("Old jam")).toBeInTheDocument();
  });

  it("shows each source's state and starts the flood-day demo", async () => {
    api.fetchAlerts.mockResolvedValue(overview());
    api.startDemo.mockResolvedValue(overview({ demo: { running: true, startedAt: "2026-10-24T09:00:00Z" } }));
    renderView();

    const sources = await screen.findByRole("list", { name: "Live sources" });
    expect(within(sources).getByText("Add TOMTOM_API_KEY to backend/.env.local")).toBeInTheDocument();
    expect(within(sources).getByText(/No data for E5, E6, E7/)).toBeInTheDocument();
    // The GloFAS forecast is shown against its flood flows, and labelled as a model, not a gauge.
    expect(within(sources).getByText("Hindon flow forecast (GloFAS)")).toBeInTheDocument();
    expect(within(sources).getByText(/2-year 232, 5-year 457/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start flood-day demo" }));
    expect(await screen.findByRole("button", { name: "Stop flood-day demo" })).toBeInTheDocument();
  });

  it("previews who a message goes to before sending it", async () => {
    api.fetchAlerts.mockResolvedValue(overview({ alerts: [river] }));
    api.fetchSendPreview.mockResolvedValue({
      message: "AEGIS [SEVERE]: Hindon at danger level", configured: { sms: false, whatsapp: true },
      recipients: [
        { recipientId: "r1", name: "ADM", role: "", phone: "+91 98•••••210", channel: "whatsapp", send: true, reason: null },
        { recipientId: "r1", name: "ADM", role: "", phone: "+91 98•••••210", channel: "sms", send: false, reason: "SMS is not configured" },
      ],
    });
    api.sendAlert.mockResolvedValue({ deliveries: [{ status: "sent" }], alert: river });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Send to phones" }));
    expect(await screen.findByText("SMS is not configured")).toBeInTheDocument();
    const list = screen.getByRole("region", { name: "Alert list" });
    fireEvent.change(within(list).getByLabelText("Your name"), { target: { value: "Control room" } });
    fireEvent.click(within(list).getByRole("button", { name: "Send to 1" }));
    await waitFor(() => expect(api.sendAlert).toHaveBeenCalledWith(river.id, "Control room"));
    expect(await screen.findByText("1 sent")).toBeInTheDocument();
  });
});
