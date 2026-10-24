"use client";

import { useState } from "react";

import { AlertBanner } from "@/components/alerts/AlertBanner";
import { AppShell, type NavId } from "@/components/layout/AppShell";
import { AlertsView } from "@/components/views/AlertsView";
import { ComparisonView } from "@/components/views/ComparisonView";
import { LiveSimulationView } from "@/components/views/LiveSimulationView";
import { OverviewView } from "@/components/views/OverviewView";
import { ReportsView } from "@/components/views/ReportsView";
import { ScenarioLabView } from "@/components/views/ScenarioLabView";
import { SettingsView } from "@/components/views/SettingsView";
import { openAlertCount } from "@/lib/alerts/alerts";
import { AlertsProvider, useAlerts } from "@/lib/alerts/AlertsContext";
import type { LiveAlert } from "@/lib/api/client";
import { useAegis } from "@/lib/state/useAegis";

export function AegisApp() {
  return (
    <AlertsProvider>
      <AegisScreens />
    </AlertsProvider>
  );
}

function AegisScreens() {
  const { state, actions, effectiveScenario } = useAegis();
  const { overview } = useAlerts();
  const [view, setView] = useState<NavId>("overview");

  const appliedIds = state.appliedAlerts.map((a) => a.id);

  /** Apply brings the alert's conditions into the Scenario Lab, where the planner runs or optimizes. */
  async function applyAlert(alert: LiveAlert) {
    await actions.applyAlert(alert);
    setView("scenario-lab");
  }

  function renderView() {
    if (view === "alerts") return <AlertsView scenario={effectiveScenario} appliedIds={appliedIds} onApply={applyAlert} />;
    if (!effectiveScenario) {
      return (
        <div className="grid h-full place-items-center p-6 text-sm text-slate-500">
          {state.error ? <p role="alert" className="max-w-md text-red-700">{state.error}</p> : "Loading scenario…"}
        </div>
      );
    }
    const props = { state, effectiveScenario, actions };
    switch (view) {
      case "live-simulation": return <LiveSimulationView {...props} />;
      case "scenario-lab": return <ScenarioLabView {...props} onRunComplete={() => setView("overview")} />;
      case "plan-comparison": return <ComparisonView {...props} />;
      case "reports": return <ReportsView {...props} />;
      case "settings": return <SettingsView {...props} />;
      case "overview":
      default:
        return <OverviewView {...props} onOpenComparison={() => setView("plan-comparison")} />;
    }
  }

  return (
    <AppShell
      activeNavId={view}
      scenarioName={state.scenario?.name ?? "Loading scenario…"}
      simulationStatus={state.status}
      onReset={actions.reset}
      onNavigate={setView}
      badges={{ alerts: overview ? openAlertCount(overview.alerts) : 0 }}
      banner={<AlertBanner scenario={effectiveScenario} appliedIds={appliedIds} onApply={applyAlert} onOpenAlerts={() => setView("alerts")} />}
    >
      {renderView()}
    </AppShell>
  );
}
