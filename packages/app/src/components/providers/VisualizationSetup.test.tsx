/**
 * Tests for VisualizationSetup error routing contracts (see #96).
 *
 * Contracts verified here:
 * 1. Whole-engine-down does NOT fire a toast and does NOT render an inline slab
 *    from this component — that surface moved to VisualizationDisplay (persistent
 *    inline affordance). VisualizationSetup just passes children through.
 * 2. VisualizationBoundary catches render-phase throws → fires a Reload-action
 *    toast that never auto-dismisses (duration: Infinity), and leaves children
 *    mounted (no renderer crash, navigation survives).
 *
 * The persistent inline engine-unavailable affordance is tested in
 * EngineUnavailableState.test.tsx (the surface) and VisualizationDisplay reads
 * the engine signals; this file only covers what VisualizationSetup still owns.
 */
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockShowError, mockUseToastStore } = vi.hoisted(() => {
  const showError = vi.fn().mockReturnValue("toast-id");
  return {
    mockShowError: showError,
    mockUseToastStore: vi.fn().mockReturnValue({ showError }),
  };
});

vi.mock("@/lib/stores/toast-store", () => ({
  useToastStore: () => mockUseToastStore(),
}));

const { mockUseChartEngine } = vi.hoisted(() => ({
  mockUseChartEngine: vi.fn().mockReturnValue({
    connector: null,
    engineError: null,
    uploadArrowTable: null,
  }),
}));

vi.mock("./ChartEngineProvider", () => ({
  useChartEngine: () => mockUseChartEngine(),
}));

const { mockInitDuckDB, mockUseDuckDBContext } = vi.hoisted(() => {
  const initDuckDB = vi.fn();
  return {
    mockInitDuckDB: initDuckDB,
    mockUseDuckDBContext: vi.fn().mockReturnValue({
      db: {},
      connection: {},
      isInitialized: true,
      isLoading: false,
      error: null,
      initDuckDB,
    }),
  };
});

vi.mock("./DuckDBProvider", () => ({
  useDuckDBContext: () => mockUseDuckDBContext(),
}));

// VisualizationProvider: stub that just renders children. The boundary test
// makes useVisualization throw to simulate a setup-component render crash.
const { mockUseVisualization } = vi.hoisted(() => ({
  mockUseVisualization: vi.fn().mockReturnValue({
    error: null,
    api: null,
    isReady: false,
    coordinator: null,
    renderer: null,
  }),
}));

vi.mock("@dashframe/visualization", () => ({
  VisualizationProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  createVgplotRenderer: vi.fn(),
  registerRenderer: vi.fn(),
  useVisualization: () => mockUseVisualization(),
}));

// ── Component under test ──────────────────────────────────────────────────────

import { VisualizationSetup } from "./VisualizationSetup";

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderSetup(children: React.ReactNode = <div>child</div>) {
  return render(<VisualizationSetup>{children}</VisualizationSetup>);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("VisualizationSetup — error routing (issue #96)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore defaults after clearAllMocks wipes mockReturnValue
    mockUseToastStore.mockReturnValue({ showError: mockShowError });
    mockUseChartEngine.mockReturnValue({
      connector: null,
      engineError: null,
      uploadArrowTable: null,
    });
    mockUseDuckDBContext.mockReturnValue({
      db: {},
      connection: {},
      isInitialized: true,
      isLoading: false,
      error: null,
      initDuckDB: mockInitDuckDB,
    });
    mockUseVisualization.mockReturnValue({
      error: null,
      api: null,
      isReady: false,
      coordinator: null,
      renderer: null,
    });
  });

  describe("whole-engine-down → no toast, no inline slab from this component", () => {
    it("does NOT fire a toast when engineError is set (surface moved to inline)", async () => {
      mockUseChartEngine.mockReturnValue({
        connector: null,
        engineError: "Native engine unavailable: connection refused",
        uploadArrowTable: null,
      });

      renderSetup();

      // Give effects a tick to fire — nothing should call showError.
      await new Promise((r) => setTimeout(r, 0));
      expect(mockShowError).not.toHaveBeenCalled();
    });

    it("does NOT render an inline ErrorState slab for the engine-down condition", () => {
      mockUseChartEngine.mockReturnValue({
        connector: null,
        engineError: "Native engine unavailable: connection refused",
        uploadArrowTable: null,
      });

      renderSetup(<div data-testid="child" />);

      // The raw engineError string must never reach the DOM (DESIGN.md:
      // no raw runtime errors in UI).
      expect(screen.queryByText(/Native engine unavailable/i)).toBeNull();
    });

    it("still passes children through when engine is down (degraded, not dead)", () => {
      mockUseChartEngine.mockReturnValue({
        connector: null,
        engineError: "Native engine unavailable: connection refused",
        uploadArrowTable: null,
      });

      renderSetup(<div data-testid="child" />);

      expect(screen.queryByTestId("child")).not.toBeNull();
    });

    it("does NOT fire a toast on the healthy path (engineError null)", async () => {
      renderSetup();

      await new Promise((r) => setTimeout(r, 0));
      expect(mockShowError).not.toHaveBeenCalled();
    });
  });

  describe("VisualizationBoundary — fail-soft on mid-session render throw", () => {
    it("renders children when connector is present (native path nominal)", () => {
      const mockConnector = { query: vi.fn() };
      mockUseChartEngine.mockReturnValue({
        connector: mockConnector,
        engineError: null,
        uploadArrowTable: null,
      });

      // Children are inside VisualizationProvider but OUTSIDE the boundary,
      // so they are always visible and never blanked by a boundary trip.
      renderSetup(<div data-testid="child" />);

      expect(screen.queryByTestId("child")).not.toBeNull();
    });

    it("catches a setup-component throw, fires a Reload-action toast that never auto-dismisses, and leaves children mounted", async () => {
      const mockConnector = { query: vi.fn() };
      mockUseChartEngine.mockReturnValue({
        connector: mockConnector,
        engineError: null,
        uploadArrowTable: null,
      });

      // Simulate a setup component (RendererRegistration) throwing by making
      // useVisualization throw during render. The boundary wraps the setup
      // subtree; children are outside the boundary and must stay mounted.
      mockUseVisualization.mockImplementation(() => {
        throw new Error("Mosaic coordinator exploded");
      });

      // Suppress React's console.error for expected error boundary events
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      // Must not throw at the render level (boundary catches it)
      expect(() => renderSetup(<div data-testid="child" />)).not.toThrow();

      // Toast must fire with the plain-language crash copy, a Reload action,
      // and Infinity duration (must not fade before the user can act).
      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalledWith(
          "Charts were reset",
          expect.objectContaining({
            description: expect.stringContaining("interrupted"),
            duration: Infinity,
            action: expect.objectContaining({
              label: "Reload",
              onClick: expect.any(Function),
            }),
          }),
        );
      });

      // The crash copy must NOT leak implementation terms.
      const [, opts] = mockShowError.mock.calls[0]!;
      expect(opts.description).not.toMatch(/native|wasm|mosaic|coordinator/i);

      // Children (shell, toaster) must remain mounted — not blanked by the boundary.
      expect(screen.queryByTestId("child")).not.toBeNull();

      consoleSpy.mockRestore();
    });
  });
});
