import type { AlertsOverview, LiveAlert } from "@/lib/api/client";

/** Test data shared by the alert tests. */
export function liveAlert(overrides: Partial<LiveAlert> = {}): LiveAlert {
  return {
    id: "a", source: "traffic", severity: "warning", title: "t", titleHi: null, detail: "", area: "",
    observedAt: "2026-10-24T09:00:00+00:00", raisedAt: "2026-10-24T09:00:00+00:00", expiresAt: null,
    status: "active", clearedReason: null, acknowledgement: null, link: null, isDemo: false,
    action: null, deliveries: [], ...overrides,
  };
}

export function overview(overrides: Partial<AlertsOverview> = {}): AlertsOverview {
  return {
    alerts: [],
    sources: {
      ndma: { label: "NDMA official alerts", state: "connected", lastCheckAt: "2026-10-24T09:00:00+00:00" },
      river: { label: "River level", state: "connected" },
      glofas: {
        label: "Hindon flow forecast (GloFAS)", state: "connected",
        forecast: {
          river: "Hindon", todayM3s: 13.89, peakM3s: 13.89, peakDate: "2026-10-24", highM3s: 13.96, highDate: "2026-10-24",
          level: "normal", thresholdsM3s: { warning: 232, severe: 457, extreme: 750 },
          returnPeriodYears: { warning: 2, severe: 5, extreme: 20 }, lookaheadDays: 7, observedAt: "2026-10-24T09:00:00+00:00",
        },
      },
      traffic: { label: "TomTom traffic", state: "not configured", reason: "Add TOMTOM_API_KEY to backend/.env.local" },
      demo: { label: "Flood-day demo", state: "stopped" },
    },
    demo: { running: false, startedAt: null },
    liveEnabled: true,
    messaging: { sms: false, whatsapp: true },
    settings: { autoSend: { warning: false, severe: false, extreme: false }, changedBy: null, changedAt: null },
    traffic: { sections: [], notCovered: { edgeIds: ["E5", "E6", "E7"], reason: "Local lanes TomTom does not cover." } },
    serverTime: "2026-10-24T09:00:00+00:00",
    ...overrides,
  };
}
