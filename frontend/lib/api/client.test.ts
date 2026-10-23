import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchScenario, runSimulation, validateScenario } from "./client";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("apiFetch error handling", () => {
  it("throws a readable error using the backend's structured error message", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false, status: 404,
      json: async () => ({ errorCode: "SCENARIO_NOT_FOUND", message: "Unknown scenario_id 'nope'" }),
    } as Response);

    await expect(fetchScenario("nope")).rejects.toThrow("Unknown scenario_id 'nope'");
  });

  it("returns the parsed JSON on success", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true, json: async () => ({ runId: "r1" }),
    } as Response);

    const result = await runSimulation({ scenarioId: "scenario_a_normal" });
    expect(result).toEqual({ runId: "r1" });
  });

  it("sends what-if overrides in the request body", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true, json: async () => ({ runId: "r1" }),
    } as Response);

    await runSimulation({ scenarioId: "scenario_a_normal", closedEdgeIds: ["E3"] });

    const [, init] = fetchSpy.mock.calls[0];
    expect(JSON.parse(init!.body as string)).toEqual({ scenarioId: "scenario_a_normal", closedEdgeIds: ["E3"] });
  });

  it("keeps the backend's field-level validation errors on the thrown error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false, status: 422,
      json: async () => ({
        errorCode: "VALIDATION_ERROR", message: "Scenario has 1 validation error(s)", field: "edges.0.target",
        errors: [{ field: "edges.0.target", message: "References unknown node 'N99'" }],
      }),
    } as Response);

    const error = await validateScenario({}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).errorCode).toBe("VALIDATION_ERROR");
    expect((error as ApiError).errors).toEqual([{ field: "edges.0.target", message: "References unknown node 'N99'" }]);
  });

  it("reports an unreachable backend in plain words instead of 'Failed to fetch'", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(fetchScenario("x")).rejects.toThrow(/Cannot reach the AEGIS backend/);
  });
});
