/**
 * Tests for VisualizationSetup error routing contracts (see #96).
 *
 * Contracts verified:
 * 1. Whole-engine-down (engineError set, no connector) → Sonner toast, NOT inline ErrorState.
 * 2. VisualizationProvider init failure → toast (whole-engine-down), NOT inline slab.
 * 3. VisualizationBoundary catches render-phase throws → toast + empty state, no crash.
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

// VisualizationProvider: stub that just renders children.
// VisualizationErrorToast reads useVisualization() from inside the provider,
// so stub useVisualization too.
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

  describe("whole-engine-down → toast, NOT inline slab", () => {
    it("fires showError toast when engineError is set and no connector", async () => {
      mockUseChartEngine.mockReturnValue({
        connector: null,
        engineError: "Native engine unavailable: connection refused",
        uploadArrowTable: null,
      });

      renderSetup();

      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalledWith(
          "Native engine unreachable",
          expect.objectContaining({
            description: expect.stringContaining("Charts are unavailable"),
          }),
        );
      });
    });

    it("does NOT render an inline ErrorState slab for engine-down condition", () => {
      mockUseChartEngine.mockReturnValue({
        connector: null,
        engineError: "Native engine unavailable: connection refused",
        uploadArrowTable: null,
      });

      renderSetup(<div data-testid="child" />);

      // Inline ErrorState would render the title text directly in the DOM.
      // With the toast-only approach, this text must not appear as an inline element.
      expect(screen.queryByText("Native engine unavailable")).toBeNull();
    });

    it("still renders children when engine is down (degraded, not dead)", () => {
      mockUseChartEngine.mockReturnValue({
        connector: null,
        engineError: "Native engine unavailable: connection refused",
        uploadArrowTable: null,
      });

      renderSetup(<div data-testid="child" />);

      expect(screen.queryByTestId("child")).not.toBeNull();
    });

    it("does NOT fire toast when engineError is null (healthy path)", async () => {
      mockUseChartEngine.mockReturnValue({
        connector: null,
        engineError: null,
        uploadArrowTable: null,
      });

      renderSetup();

      // Give effects a tick to fire
      await new Promise((r) => setTimeout(r, 0));
      expect(mockShowError).not.toHaveBeenCalledWith(
        "Native engine unreachable",
        expect.anything(),
      );
    });
  });

  describe("VisualizationProvider init failure → toast, NOT inline slab", () => {
    it("fires showError toast when VisualizationProvider fails to initialize", async () => {
      // Connector is present (desktop path), so the native VisualizationProvider
      // branch is taken. Inside it, useVisualization().error is set.
      const mockConnector = { query: vi.fn() };
      mockUseChartEngine.mockReturnValue({
        connector: mockConnector,
        engineError: null,
        uploadArrowTable: null,
      });
      mockUseVisualization.mockReturnValue({
        error: new Error("Failed to load @uwdata/vgplot"),
        api: null,
        isReady: false,
        coordinator: null,
        renderer: null,
      });

      renderSetup();

      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalledWith(
          "Visualization engine failed to start",
          expect.objectContaining({
            description: expect.stringContaining("Charts may not render"),
          }),
        );
      });
    });
  });

  describe("VisualizationBoundary — fail-soft on mid-session render throw", () => {
    it("renders children normally when no error is thrown", () => {
      const mockConnector = { query: vi.fn() };
      mockUseChartEngine.mockReturnValue({
        connector: mockConnector,
        engineError: null,
        uploadArrowTable: null,
      });

      renderSetup(<div data-testid="child" />);

      expect(screen.queryByTestId("child")).not.toBeNull();
    });

    it("catches render-phase throw from child, does not re-throw, fires toast", async () => {
      const mockConnector = { query: vi.fn() };
      mockUseChartEngine.mockReturnValue({
        connector: mockConnector,
        engineError: null,
        uploadArrowTable: null,
      });

      // Child that throws on render — simulates Mosaic/vgplot throwing when
      // the engine is gone mid-session.
      function BrokenChild(): React.ReactElement {
        throw new Error("Native engine timed out");
      }

      // Suppress React's console.error for expected error boundary events
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      // Must not throw at the render level (boundary catches it)
      expect(() => renderSetup(<BrokenChild />)).not.toThrow();

      // Toast must fire with crash signal
      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalledWith(
          "Chart engine crashed mid-session",
          expect.objectContaining({
            description: expect.stringContaining("Reload to reconnect"),
          }),
        );
      });

      consoleSpy.mockRestore();
    });
  });
});
