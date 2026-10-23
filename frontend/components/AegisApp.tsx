"use client";

import { useState } from "react";

import { AppShell, type NavId } from "@/components/layout/AppShell";
import { ComparisonView } from "@/components/views/ComparisonView";
import { LiveSimulationView } from "@/components/views/LiveSimulationView";
import { OverviewView } from "@/components/views/OverviewView";
import { ReportsView } from "@/components/views/ReportsView";
import { ScenarioLabView } from "@/components/views/ScenarioLabView";
import { SettingsView } from "@/components/views/SettingsView";
import { useAegis } from "@/lib/state/useAegis";

export function AegisApp() {
  const { state, actions, effectiveScenario } = useAegis();
  const [view, setView] = useState<NavId>("overview");

  function renderView() {
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
    >
      {renderView()}
    </AppShell>
  );
}
