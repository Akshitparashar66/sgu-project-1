import { describe, expect, it } from "vitest";

import type { AlertsOverview } from "@/lib/api/client";
import type { ScenarioConfig } from "@/lib/schemas/types";
import { applicability, areaAlerts, bannerAlert, openAlertCount, roadConditions, timeAgo } from "./alerts";
import { liveAlert } from "./testAlerts";

const scenario = { edges: [{ id: "E1" }, { id: "E4" }] } as unknown as ScenarioConfig;

describe("bannerAlert", () => {
  it("picks the most serious open alert, newest among equals, and never info or acknowledged ones", () => {
    const alerts = [
      liveAlert({ id: "info", severity: "info" }),
      liveAlert({ id: "old-severe", severity: "severe", raisedAt: "2026-10-24T08:00:00+00:00" }),
      liveAlert({ id: "new-severe", severity: "severe", raisedAt: "2026-10-24T09:30:00+00:00" }),
      liveAlert({ id: "acked-extreme", severity: "extreme", status: "acknowledged" }),
      liveAlert({ id: "warning" }),
    ];
    expect(bannerAlert(alerts)?.id).toBe("new-severe");
    expect(openAlertCount(alerts)).toBe(3);
    expect(bannerAlert([liveAlert({ severity: "info" })])).toBeNull();
  });
});

describe("roadConditions / areaAlerts", () => {
  it("puts traffic readings and road alerts on their roads, and the rest in the badge", () => {
    const overview = {
      alerts: [
        liveAlert({ id: "jam", edgeIds: ["E1", "E4"], severity: "severe" }),
        liveAlert({ id: "river", source: "river", edgeIds: [] }),
        liveAlert({ id: "gone", edgeIds: ["E2"], status: "expired" }),
      ],
      sources: { traffic: { readings: [
        { sectionId: "g", name: "Gaur Cascades Rd", edgeIds: ["E2", "E3"], currentSpeed: 26, freeFlowSpeed: 26,
          ratio: 1, closed: false, usable: true, observedAt: "" },
      ] } },
    } as unknown as AlertsOverview;
    const roads = roadConditions(overview);
    expect(roads.E1.alert?.id).toBe("jam");
    expect(roads.E2.reading?.currentSpeed).toBe(26);
    expect(roads.E2.alert).toBeUndefined();
    expect(areaAlerts(overview).map((a) => a.id)).toEqual(["river"]);
  });
});

describe("applicability", () => {
  it("allows opening a scenario, or road changes the loaded scenario has", () => {
    expect(applicability(liveAlert({ action: { label: "x", scenarioId: "scenario_d" } }), scenario).ok).toBe(true);
    expect(applicability(liveAlert({ action: { label: "x", edgeCapacityFactors: { E4: 0.25 } } }), scenario).ok).toBe(true);
    const elsewhere = applicability(liveAlert({ action: { label: "x", closedEdgeIds: ["E9"] } }), scenario);
    expect(elsewhere).toEqual({ ok: false, reason: "The loaded scenario has no road E9" });
    expect(applicability(liveAlert(), scenario).ok).toBe(false);
  });
});

describe("timeAgo", () => {
  it("reads naturally", () => {
    const now = new Date("2026-10-24T09:10:00Z");
    expect(timeAgo("2026-10-24T09:09:50Z", now)).toBe("just now");
    expect(timeAgo("2026-10-24T09:00:00Z", now)).toBe("10 min ago");
    expect(timeAgo("2026-10-24T06:10:00Z", now)).toBe("3 h ago");
  });
});
