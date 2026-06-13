import type { ChartConfig, ChartRenderer } from "@dashframe/core";
import type { VisualizationType } from "@dashframe/types";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRegistry, registerRenderer } from "../registry";

// Mock the provider context so we can drive `renderer` / `isReady` directly
// without spinning up a real Mosaic coordinator (async, needs vgplot/DuckDB).
const mockUseVisualization = vi.fn();
vi.mock("../VisualizationProvider", () => ({
  useVisualization: () => mockUseVisualization(),
}));

// Mock container dimensions so Chart proceeds to render (canRender = true).
vi.mock("@dashframe/ui", () => ({
  useContainerDimensions: () => ({
    ref: { current: document.createElement("div") },
    width: 400,
    height: 300,
    isReady: true,
  }),
}));

import { Chart } from "./Chart";

function makeRenderer(
  tag: string,
  calls: Array<{ tag: string; config: ChartConfig }>,
): ChartRenderer {
  return {
    supportedTypes: ["barY"] as readonly VisualizationType[],
    render(_container: HTMLElement, _type: VisualizationType, config) {
      calls.push({ tag, config });
      return () => {};
    },
  };
}

describe("Chart renderer resolution", () => {
  beforeEach(() => {
    clearRegistry();
    mockUseVisualization.mockReset();
  });

  afterEach(() => {
    clearRegistry();
  });

  it("renders via the provider-context renderer, not the global one, when both exist", () => {
    const calls: Array<{ tag: string; config: ChartConfig }> = [];

    // Global registry has the NATIVE renderer (what a desktop page registers).
    registerRenderer(makeRenderer("global-native", calls));

    // The enclosing provider supplies a WASM-bound renderer (the fallback).
    const contextRenderer = makeRenderer("context-wasm", calls);
    mockUseVisualization.mockReturnValue({
      renderer: contextRenderer,
      isReady: true,
      error: null,
    });

    render(
      <Chart
        tableName="insight_view_x"
        visualizationType={"barY" as VisualizationType}
        encoding={{ x: "a", y: "b" }}
      />,
    );

    // Exactly one render, and it must be the context (WASM) renderer — proving
    // the per-insight fallback routes to the provider's engine, not the global
    // native one. This is the core of the Codex finding.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.tag).toBe("context-wasm");
    expect(calls[0]!.config.tableName).toBe("insight_view_x");
  });

  it("falls back to the global registry when the provider has no renderer (web/WASM-only)", () => {
    const calls: Array<{ tag: string; config: ChartConfig }> = [];

    registerRenderer(makeRenderer("global", calls));

    // No context renderer, but provider is READY (web path: renderer registered
    // globally by RendererRegistration, context renderer not used). Not the
    // initializing window, so the global registry is the correct source.
    mockUseVisualization.mockReturnValue({
      renderer: null,
      isReady: true,
      error: null,
    });

    render(
      <Chart
        tableName="t"
        visualizationType={"barY" as VisualizationType}
        encoding={{ x: "a", y: "b" }}
      />,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.tag).toBe("global");
  });

  it("does NOT render against the global renderer while the provider is still initializing", () => {
    const calls: Array<{ tag: string; config: ChartConfig }> = [];

    // Global native renderer is present...
    registerRenderer(makeRenderer("global-native", calls));

    // ...but the enclosing provider hasn't finished bringing up its engine:
    // no renderer, not ready, no error. Chart must wait, not route to native.
    mockUseVisualization.mockReturnValue({
      renderer: null,
      isReady: false,
      error: null,
    });

    render(
      <Chart
        tableName="insight_view_fallback"
        visualizationType={"barY" as VisualizationType}
        encoding={{ x: "a", y: "b" }}
      />,
    );

    // No render happened — the wrong-engine flash is prevented.
    expect(calls).toHaveLength(0);
  });
});
