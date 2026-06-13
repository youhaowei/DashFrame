import { useToastStore } from "@/lib/stores/toast-store";
import {
  VisualizationProvider,
  createVgplotRenderer,
  registerRenderer,
  useVisualization,
} from "@dashframe/visualization";
import { ErrorState } from "@wystack/ui";
import { Component, useCallback, useEffect, type ReactNode } from "react";
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
 * Fires a Sonner error toast when the VisualizationProvider fails to
 * initialize its Mosaic coordinator (e.g. vgplot import failure, connector
 * rejected). This is a whole-engine-init failure, not a per-chart failure,
 * so it surfaces as a toast rather than an inline slab. Children continue
 * to render — the failure is transient/recoverable and the user can retry
 * by reloading.
 */
function VisualizationErrorToast() {
  const { error } = useVisualization();
  const { showError } = useToastStore();

  useEffect(() => {
    if (!error) return;
    showError("Visualization engine failed to start", {
      description: "Charts may not render. Reload to retry.",
      duration: 8000,
    });
  }, [error, showError]);

  return null;
}

// ============================================================================
// Error Boundary
// ============================================================================

/**
 * Catches render-phase throws from the visualization subtree.
 *
 * When the engine dies mid-session, pending Mosaic/vgplot updates can throw
 * synchronously during a render (e.g. a coordinator callback that runs after
 * the connector is gone). Without a boundary these throws propagate to React's
 * root and kill the renderer process. The boundary catches them, shows the
 * `fallback` (empty state + toast via `onError`), and prevents a renderer crash.
 *
 * This is the "fail-soft" layer: an unhandled throw that would otherwise take
 * the renderer down degrades to a visible empty state instead.
 */
interface VisualizationBoundaryState {
  hasError: boolean;
}

interface VisualizationBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
  onError?: (err: Error) => void;
}

class VisualizationBoundary extends Component<
  VisualizationBoundaryProps,
  VisualizationBoundaryState
> {
  constructor(props: VisualizationBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): VisualizationBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(err: Error, info: React.ErrorInfo) {
    console.error("[VisualizationBoundary] caught render error:", err, info);
    this.props.onError?.(err);
  }

  override render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

/**
 * Hook that fires a toast for a whole-engine-down condition, then returns
 * nothing. Separated so the toast logic can consume hooks (useToastStore)
 * while the boundary above it is a class component.
 */
function EngineErrorToast({ engineError }: { engineError: string }) {
  const { showError } = useToastStore();

  useEffect(() => {
    showError("Native engine unreachable", {
      description:
        "Charts are unavailable. Reload to reconnect to the local engine.",
      duration: 10000,
    });
    // Only fire once per engineError value change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineError]);

  return null;
}

/**
 * Fallback shown inside the VisualizationBoundary when a mid-session engine
 * crash causes a render-phase throw. Renders nothing visible — the toast (fired
 * by the onError callback) is the user-facing signal. Children outside the
 * visualization subtree (navigation, data sources, etc.) are unaffected.
 */
function VisualizationCrashedFallback() {
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
 *   is present, this component wires the connector into VisualizationProvider.
 *   DuckDB-WASM still initializes on the desktop path because useInsightView
 *   depends on it to load DataFrames before uploading them to the native engine.
 *
 * ## Error surfaces
 *
 * - Native bootstrap failure (connector=null, engineError set): shown as a
 *   Sonner toast (whole-engine-down condition); WASM path used as fallback for
 *   non-chart content.
 * - Native connector healthy but WASM failed: WASM error shown as an inline
 *   ErrorState inside the native provider (chart queries still route to native;
 *   data-viewer paths that need WASM see the banner).
 * - WASM-only path failure: standard ErrorState with retry.
 * - Mid-session render throw (engine dies while rendering): caught by
 *   VisualizationBoundary → toast + empty state, never crashes the renderer.
 *
 * ## Error routing
 *
 * | Condition                               | Surface          |
 * |-----------------------------------------|------------------|
 * | Whole engine unreachable (engineError)  | Sonner toast     |
 * | VisualizationProvider init failure      | Sonner toast     |
 * | Mid-session render-phase throw          | Boundary + toast |
 * | Per-chart compute failure (insightView) | Inline ErrorState (in VisualizationDisplay) |
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
  const { showError } = useToastStore();

  const handleRetry = useCallback(() => {
    initDuckDB();
  }, [initDuckDB]);

  // Callback fired by VisualizationBoundary on a render-phase throw. Shows a
  // toast so the user knows something degraded without crashing the renderer.
  const handleBoundaryError = useCallback(
    (_err: Error) => {
      showError("Chart engine crashed mid-session", {
        description: "Charts have been reset. Reload to reconnect.",
        duration: 10000,
      });
    },
    [showError],
  );

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
      <VisualizationBoundary
        fallback={<VisualizationCrashedFallback />}
        onError={handleBoundaryError}
      >
        <VisualizationProvider connector={connector}>
          <RendererRegistration />
          <VisualizationErrorToast />
          {wasmErrorBanner}
          {children}
        </VisualizationProvider>
      </VisualizationBoundary>
    );
  }

  // ── WASM path (web tier default) OR native bootstrap failure ─────────────
  // When the Electron IPC call fails or returns missing server info, `main.tsx`
  // sets engineError with connector=null. Fire a toast for the whole-engine-down
  // condition (never an inline slab — see error routing table above), then fall
  // through to the WASM path so non-chart content still renders.
  //
  // Show error state if DuckDB WASM initialization failed
  if (error) {
    return (
      <>
        {engineError && <EngineErrorToast engineError={engineError} />}
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
        {engineError && <EngineErrorToast engineError={engineError} />}
        {children}
      </>
    );
  }

  return (
    <>
      {engineError && <EngineErrorToast engineError={engineError} />}
      <VisualizationProvider db={db} connection={connection}>
        <RendererRegistration />
        <VisualizationErrorToast />
        {children}
      </VisualizationProvider>
    </>
  );
}
