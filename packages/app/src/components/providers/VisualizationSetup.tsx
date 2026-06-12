import {
  VisualizationProvider,
  createVgplotRenderer,
  registerRenderer,
  useVisualization,
} from "@dashframe/visualization";
import { ErrorState } from "@wystack/ui";
import { useCallback, useEffect, type ReactNode } from "react";
import { useChartEngine } from "./ChartEngineProvider";
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
 * Engine selection is surface-scoped (no `isElectron` branches here):
 * - Web tier / WASM path: DuckDBProvider initializes the WASM engine; this
 *   component wraps children with VisualizationProvider once it's ready.
 * - Desktop tier / native path: the host ProviderWrapper mounts a
 *   ChartEngineProvider with a pre-built Mosaic Connector. When that connector
 *   is present, this component bypasses WASM entirely and wires the connector
 *   into VisualizationProvider instead.
 *
 * ## Provider Hierarchy
 *
 * ### Web (WASM):
 * ```
 * DuckDBProvider (handles lazy loading via requestIdleCallback)
 *     └── VisualizationSetup
 *           └── VisualizationProvider (wasmConnector → Mosaic coordinator)
 *                 └── RendererRegistration (registers vgplot)
 *                 └── children
 * ```
 *
 * ### Desktop (native engine):
 * ```
 * ChartEngineProvider (native Mosaic connector — supplied by desktop host)
 *     └── DuckDBProvider (still runs for table/pagination — data-viewer paths)
 *         └── VisualizationSetup
 *               └── VisualizationProvider (native connector → Mosaic coordinator)
 *                     └── RendererRegistration (registers vgplot)
 *                     └── children
 * ```
 */
export function VisualizationSetup({ children }: VisualizationSetupProps) {
  const { connector, engineError } = useChartEngine();
  const { db, connection, isInitialized, isLoading, error, initDuckDB } =
    useDuckDBContext();

  const handleRetry = useCallback(() => {
    initDuckDB();
  }, [initDuckDB]);

  // ── Native engine path (desktop host supplied a connector) ──────────────
  if (connector) {
    // Show a visible banner when the native engine is degraded/unavailable.
    // Never surface raw engine strings (DESIGN.md anti-pattern).
    if (engineError) {
      return (
        <>
          <ErrorState
            title="Native engine unavailable"
            description={engineError}
            className="min-h-[200px]"
          />
          {children}
        </>
      );
    }

    return (
      <VisualizationProvider connector={connector}>
        <RendererRegistration />
        {children}
      </VisualizationProvider>
    );
  }

  // ── WASM path (web tier default) ─────────────────────────────────────────

  // Show error state if DuckDB WASM initialization failed
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
