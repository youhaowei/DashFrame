"use client";

import {
  VisualizationProvider,
  createVegaLiteRenderer,
  registerRenderer,
} from "@dashframe/visualization";
import { ErrorState } from "@stdui/react";
import { useCallback, useEffect, type ReactNode } from "react";
import { useDuckDBContext } from "./DuckDBProvider";

// ============================================================================
// Renderer Registration
// ============================================================================

// Module-level renderer instance — avoids recreating on HMR/Strict Mode remounts
const vegaLiteRenderer = createVegaLiteRenderer();

/**
 * Registers the Vega-Lite renderer on mount.
 * registerRenderer() is idempotent — won't cause re-renders if types already registered.
 */
function RendererRegistration() {
  useEffect(() => {
    registerRenderer(vegaLiteRenderer);
  }, []);

  return null;
}

// ============================================================================
// Provider Wrapper
// ============================================================================

interface VisualizationSetupProps {
  children: ReactNode;
}

/**
 * VisualizationSetup - Wires up the visualization system.
 *
 * 1. Consumes DuckDB state from DuckDBProvider
 * 2. Shows error UI if DuckDB initialization fails
 * 3. Registers the Vega-Lite renderer on mount
 *
 * ## Provider Hierarchy
 *
 * ```
 * DuckDBProvider (handles lazy loading)
 *     └── VisualizationSetup (error UI + renderer registration)
 *           └── VisualizationProvider (signals readiness)
 *                 └── RendererRegistration (registers Vega-Lite)
 *                 └── children
 * ```
 */
export function VisualizationSetup({ children }: VisualizationSetupProps) {
  const { error, initDuckDB } = useDuckDBContext();

  const handleRetry = useCallback(() => {
    initDuckDB();
  }, [initDuckDB]);

  // Show error state if DuckDB initialization failed
  if (error) {
    return (
      <>
        <ErrorState
          title="Failed to initialize data engine"
          description={error.message}
          retryAction={{ label: "Retry", onClick: handleRetry }}
          className="min-h-[200px]"
        />
        {children}
      </>
    );
  }

  return (
    <VisualizationProvider>
      <RendererRegistration />
      {children}
    </VisualizationProvider>
  );
}
