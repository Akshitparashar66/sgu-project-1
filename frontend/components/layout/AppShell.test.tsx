import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

describe("AppShell", () => {
  it("marks the active nav item distinctly and shows the synthetic-data indicator (PRD §4.2)", () => {
    render(
      <AppShell activeNavId="overview" scenarioName="Normal Conditions" simulationStatus="idle" onReset={vi.fn()}>
        <div>content</div>
      </AppShell>
    );

    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Live Simulation" })).not.toHaveAttribute("aria-current");
    expect(screen.getByText(/Synthetic data/i)).toBeInTheDocument();
    expect(screen.getByText("Normal Conditions")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("idle");
  });

  it("never shows a fake 'connected' live-data status (PRD §4.2.B)", () => {
    render(
      <AppShell activeNavId="overview" scenarioName="x" simulationStatus="idle" onReset={vi.fn()}>
        <div />
      </AppShell>
    );
    expect(screen.queryByText(/connected/i)).not.toBeInTheDocument();
  });

  it("switches views through onNavigate instead of following the anchor", () => {
    const onNavigate = vi.fn();
    render(
      <AppShell activeNavId="overview" scenarioName="x" simulationStatus="idle" onReset={vi.fn()} onNavigate={onNavigate}>
        <div />
      </AppShell>
    );

    fireEvent.click(screen.getByRole("link", { name: "Plan Comparison" }));

    expect(onNavigate).toHaveBeenCalledWith("plan-comparison");
  });

  it("shows open alerts on the Alerts item and the banner above every page", () => {
    render(
      <AppShell activeNavId="overview" scenarioName="x" simulationStatus="idle" onReset={vi.fn()}
        badges={{ alerts: 2 }} banner={<div role="alert">Hindon at danger level</div>}>
        <div />
      </AppShell>
    );
    expect(screen.getByRole("link", { name: /Alerts/ })).toHaveTextContent("2");
    expect(screen.getByRole("alert")).toHaveTextContent("Hindon at danger level");
  });
});
