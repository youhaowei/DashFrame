"use client";

import { ErrorState } from "@dashframe/ui";
import {
  VisualizationProvider,
  createVgplotRenderer,
  registerRenderer,
  useVisualization,
} from "@dashframe/visualization";
import { useCallback, useEffect, type ReactNode } from "react";
import { useDuckDBContext } from "./DuckDBProvider";

// ============================================================================
// Renderer Registration
// ============================================================================

/**
 * Registers chart renderers when the visualization system is ready.
 * This component runs on mount and sets up the vgplot renderer.
 *
 * Note: registerRenderer() is idempotent - it only triggers re-renders
 * when registering genuinely new chart types, not when re-registering
 * existing types (e.g., during HMR or component remounts).
 */
function RendererRegistration() {
  const { api, isReady } = useVisualization();

  useEffect(() => {
    if (isReady && api) {
      // Register vgplot renderer for standard chart types
      // This is idempotent - won't cause re-renders if types already registered
      registerRenderer(createVgplotRenderer(api));
    }
  }, [api, isReady]);

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
 * This component:
 * 1. Consumes DuckDB state from DuckDBProvider (which handles lazy loading)
 * 2. Shows error UI if DuckDB initialization fails
 * 3. Wraps children with VisualizationProvider once DuckDB is ready
 * 4. Registers the vgplot renderer on mount
 *
 * ## Provider Hierarchy
 *
 * ```
 * DuckDBProvider (handles lazy loading via requestIdleCallback)
 *     └── VisualizationSetup (this component - shows error UI, wraps with Mosaic)
 *           └── VisualizationProvider (creates Mosaic coordinator)
 *                 └── RendererRegistration (registers vgplot)
 *                 └── children
 * ```
 *
 * ## Usage
 *
 * ```tsx
 * // In layout.tsx
 * <DuckDBProvider>
 *   <VisualizationSetup>
 *     <App />
 *   </VisualizationSetup>
 * </DuckDBProvider>
 * ```
 *
 * ## Note
 *
 * DuckDB initialization is triggered by DuckDBProvider during browser idle time.
 * Children are rendered immediately (pass-through during loading).
 * Error UI is shown here if DuckDB initialization fails.
 * VisualizationProvider is only rendered after DuckDB is ready.
 */
export function VisualizationSetup({ children }: VisualizationSetupProps) {
  const { db, connection, isInitialized, isLoading, error, initDuckDB } =
    useDuckDBContext();

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
  // Pass through children during loading - components handle their own loading states
  if (isLoading || !isInitialized || !db || !connection) {
    return <>{children}</>;
  }

  return (
    <VisualizationProvider db={db} connection={connection}>
      <RendererRegistration />
      {children}
    </VisualizationProvider>
  );
}
