"use client";

import { useState } from "react";

import { AppShell, type NavId } from "@/components/layout/AppShell";
import { ComparisonView } from "@/components/views/ComparisonView";
import { OverviewView } from "@/components/views/OverviewView";
import { useAegis } from "@/lib/state/useAegis";

export function AegisApp() {
  const { state, actions, effectiveScenario } = useAegis();
  const [view, setView] = useState<NavId>("overview");

  return (
    <AppShell
      activeNavId={view}
      scenarioName={state.scenario?.name ?? "Loading scenario…"}
      simulationStatus={state.status}
      onReset={actions.reset}
      onNavigate={setView}
    >
      {!effectiveScenario ? (
        <div className="grid h-full place-items-center p-6 text-sm text-slate-400">
          {state.error ? <p role="alert" className="max-w-md text-red-300">{state.error}</p> : "Loading scenario…"}
        </div>
      ) : view === "plan-comparison" ? (
        <ComparisonView state={state} actions={actions} />
      ) : (
        <OverviewView
          state={state}
          effectiveScenario={effectiveScenario}
          actions={actions}
          onOpenComparison={() => setView("plan-comparison")}
        />
      )}
    </AppShell>
  );
}
