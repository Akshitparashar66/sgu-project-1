import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Legend } from "./Legend";

describe("Legend", () => {
  it("lists every road/shelter/agent state so color is never the only signal (PRD §12.3)", () => {
    render(<Legend />);
    expect(screen.getByRole("list", { name: "Map legend" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(9);
    expect(screen.getByText("Closed road")).toBeInTheDocument();
    expect(screen.getByText("Shelter — full")).toBeInTheDocument();
    expect(screen.getByText("Agent — unserved")).toBeInTheDocument();
  });
});
