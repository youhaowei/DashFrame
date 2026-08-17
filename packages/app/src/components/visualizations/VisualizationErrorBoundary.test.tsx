/**
 * Containment tests for the per-visualization error boundary (GH #289).
 *
 * The regression these lock down is NOT "the boundary catches" in the abstract:
 * it is that a render throw from ONE chart leaves the rest of the page mounted.
 * Before the boundary the nearest catch was the router's `errorComponent`, so a
 * single malformed encoding replaced the whole page — home included.
 */
import { cleanup, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { VisualizationErrorBoundary } from "./VisualizationErrorBoundary";

/** Reproduces the real failure: `parseEncoding` calling `.startsWith` on an object. */
function ThrowsLikeAMalformedEncoding(): never {
  const value = { field: "region" } as unknown as string;
  value.startsWith("field:");
  throw new Error("unreachable");
}

describe("VisualizationErrorBoundary", () => {
  beforeEach(() => {
    // React logs caught errors through console.error; the boundary adds its
    // own. Silence both so a passing run is not a wall of red.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders its children when nothing throws", () => {
    render(
      <VisualizationErrorBoundary>
        <div>chart</div>
      </VisualizationErrorBoundary>,
    );
    expect(screen.getByText("chart")).toBeTruthy();
  });

  it("contains a render throw to its own card", () => {
    render(
      <VisualizationErrorBoundary>
        <ThrowsLikeAMalformedEncoding />
      </VisualizationErrorBoundary>,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Can't display this chart",
    );
  });

  it("leaves sibling visualizations and the surrounding page mounted", () => {
    render(
      <div>
        <h1>Home</h1>
        <VisualizationErrorBoundary>
          <ThrowsLikeAMalformedEncoding />
        </VisualizationErrorBoundary>
        <VisualizationErrorBoundary>
          <div>healthy chart</div>
        </VisualizationErrorBoundary>
      </div>,
    );

    expect(screen.getByText("Home")).toBeTruthy();
    expect(screen.getByText("healthy chart")).toBeTruthy();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("uses the caller's fallback when one is supplied", () => {
    render(
      <VisualizationErrorBoundary fallback={<div>custom fallback</div>}>
        <ThrowsLikeAMalformedEncoding />
      </VisualizationErrorBoundary>,
    );
    expect(screen.getByText("custom fallback")).toBeTruthy();
  });

  it("logs the caught error so the failure is not silent for an operator", () => {
    render(
      <VisualizationErrorBoundary>
        <ThrowsLikeAMalformedEncoding />
      </VisualizationErrorBoundary>,
    );
    expect(console.error).toHaveBeenCalledWith(
      "Visualization failed to render",
      expect.any(Error),
      expect.anything(),
    );
  });

  it("retries when resetKey changes — a fixed chart recovers without a reload", () => {
    const { rerender } = render(
      <VisualizationErrorBoundary resetKey="v1">
        <ThrowsLikeAMalformedEncoding />
      </VisualizationErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();

    rerender(
      <VisualizationErrorBoundary resetKey="v2">
        <div>repaired chart</div>
      </VisualizationErrorBoundary>,
    );
    expect(screen.getByText("repaired chart")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the error while resetKey is unchanged", () => {
    const { rerender } = render(
      <VisualizationErrorBoundary resetKey="v1">
        <ThrowsLikeAMalformedEncoding />
      </VisualizationErrorBoundary>,
    );
    rerender(
      <VisualizationErrorBoundary resetKey="v1">
        <div>still broken</div>
      </VisualizationErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText("still broken")).toBeNull();
  });
});
