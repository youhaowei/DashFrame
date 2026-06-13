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

/**
 * Surfaces post-mount VisualizationProvider failures as a visible ErrorState.
 *
 * VisualizationProvider may throw AFTER mount (e.g. vgplot import failure,
 * wasmConnector/databaseConnector throw). Without this component the error
 * lives only in `useVisualization().error` and nothing renders — a silent
 * failure. Mounted inside each VisualizationProvider branch, this component
 * reads the provider's error and shows ErrorState so the user always sees
 * something actionable.
 *
 * A separate ticket tracks moving engine-unreachable errors to a toast. This
 * component only ensures the post-mount failure path is VISIBLE — matching the
 * existing ErrorState pattern — without changing the UX for the common case.
 */
function VisualizationErrorBanner() {
  const { error } = useVisualization();
  if (!error) return null;
  return (
    <ErrorState
      title="Visualization engine error"
      description={error.message}
      className="min-h-[200px]"
    />
  );
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
 *   is present, this component wires the connector into VisualizationProvider.
 *   DuckDB-WASM still initializes on the desktop path because useInsightView
 *   depends on it to load DataFrames before uploading them to the native engine.
 *
 * ## Error surfaces
 *
 * - Native bootstrap failure (connector=null, engineError set): shown as a
 *   banner above children; WASM path used as fallback for non-chart content.
 * - Native connector healthy but WASM failed: WASM error shown inside the
 *   native provider (chart queries still route to native; data-viewer paths
 *   that need WASM see the banner).
 * - WASM-only path failure: standard ErrorState with retry.
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
 *                     └── [WASM error banner if DuckDB-WASM failed]
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
    // Chart queries route to the native engine via the connector.
    // DuckDB-WASM still runs for data-viewer paths (useInsightView needs
    // connection to load DataFrames before uploading them to the native engine).
    // If WASM fails, surface it as a banner inside the native provider so chart
    // content still renders while the user sees what's degraded.
    const wasmErrorBanner =
      error && !isLoading ? (
        <ErrorState
          title="Failed to initialize data engine"
          description={error.message}
          retryAction={{ label: "Retry", onClick: handleRetry }}
          className="min-h-[200px]"
        />
      ) : null;

    return (
      <VisualizationProvider connector={connector}>
        <RendererRegistration />
        <VisualizationErrorBanner />
        {wasmErrorBanner}
        {children}
      </VisualizationProvider>
    );
  }

  // ── WASM path (web tier default) OR native bootstrap failure ─────────────
  // When the Electron IPC call fails or returns missing server info, `main.tsx`
  // sets engineError with connector=null. Show the native-engine error banner
  // above children, then fall through to the WASM path so non-chart content
  // still renders. Never surface raw engine strings (DESIGN.md anti-pattern).
  const nativeErrorBanner = engineError ? (
    <ErrorState
      title="Native engine unavailable"
      description={engineError}
      className="min-h-[200px]"
    />
  ) : null;

  // Show error state if DuckDB WASM initialization failed
  if (error) {
    return (
      <>
        {nativeErrorBanner}
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
    return (
      <>
        {nativeErrorBanner}
        {children}
      </>
    );
  }

  return (
    <>
      {nativeErrorBanner}
      <VisualizationProvider db={db} connection={connection}>
        <RendererRegistration />
        <VisualizationErrorBanner />
        {children}
      </VisualizationProvider>
    </>
  );
}
