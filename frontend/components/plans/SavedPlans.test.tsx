import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedPlanSummary } from "@/lib/api/client";
import type { ScenarioConfig } from "@/lib/schemas/types";
import { initialAegisState } from "@/lib/state/aegisReducer";
import { SavedPlans, SavePlanForm } from "./SavedPlans";

const api = { savePlan: vi.fn(), listSavedPlans: vi.fn(), approvePlan: vi.fn(), fetchAuditLog: vi.fn() };
vi.mock("@/lib/api/client", () => ({
  savePlan: (...a: unknown[]) => api.savePlan(...a),
  listSavedPlans: (...a: unknown[]) => api.listSavedPlans(...a),
  approvePlan: (...a: unknown[]) => api.approvePlan(...a),
  fetchAuditLog: (...a: unknown[]) => api.fetchAuditLog(...a),
}));

const draft: SavedPlanSummary = {
  id: "p1", name: "Monsoon plan", version: 2, savedAt: "2026-10-24T05:00:00+00:00", preparedBy: "A. Planner", note: "",
  scenarioId: "d", scenarioName: "Hindon River Flood", feasible: true,
  summary: { optimized: { unserved: 0, clearanceMinutes: 37 } }, approvals: [], contentHash: "abc123def456", intact: true,
};

describe("SavePlanForm", () => {
  it("saves the plan for the exact inputs on screen", async () => {
    api.savePlan.mockResolvedValue({ ...draft, version: 3 });
    const state = { ...initialAegisState, scenario: { id: "d" } as ScenarioConfig, seed: 7 };
    render(<SavePlanForm state={state} />);

    fireEvent.change(screen.getByLabelText("Plan name"), { target: { value: "Monsoon plan" } });
    fireEvent.change(screen.getByLabelText("Prepared by"), { target: { value: "A. Planner" } });
    fireEvent.click(screen.getByRole("button", { name: /Save plan/ }));

    expect(await screen.findByText(/as version 3/)).toBeInTheDocument();
    expect(api.savePlan).toHaveBeenCalledWith({
      name: "Monsoon plan", preparedBy: "A. Planner", note: "", scenarioId: "d", randomSeed: 7, closedEdgeIds: [], unavailableShelterIds: [],
    });
  });
});

describe("SavedPlans", () => {
  beforeEach(() => Object.values(api).forEach((f) => f.mockReset()));

  it("lists plans, approves a draft and shows the audit trail", async () => {
    api.listSavedPlans.mockResolvedValueOnce([draft]).mockResolvedValueOnce([{ ...draft, approvals: [{ by: "ADM", at: "", note: "" }] }]);
    api.fetchAuditLog.mockResolvedValue([{ at: "2026-10-24T05:00:00+00:00", event: "saved", planId: "p1", name: "Monsoon plan", version: 2, by: "A. Planner", note: "", contentHash: "abc123def456" }]);
    api.approvePlan.mockResolvedValue({});
    render(<SavedPlans />);

    expect(await screen.findByText("Draft")).toBeInTheDocument();
    expect(screen.getByText(/0 unserved, clears in 37 min/)).toBeInTheDocument();
    expect(screen.getByText("Audit trail (1 events)")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Approved by"), { target: { value: "ADM" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(api.approvePlan).toHaveBeenCalledWith("p1", { approvedBy: "ADM" }));
    expect(await screen.findByText(/Approved by ADM/)).toBeInTheDocument();
  });

  it("flags a plan changed after saving instead of offering approval", async () => {
    api.listSavedPlans.mockResolvedValue([{ ...draft, intact: false }]);
    api.fetchAuditLog.mockResolvedValue([]);
    render(<SavedPlans />);

    expect(await screen.findByText(/Changed after saving/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });
});
