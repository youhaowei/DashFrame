import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Containment boundary for ONE visualization's render.
 *
 * Without it, the nearest boundary above a chart is the router's own
 * `errorComponent`, so a single malformed visualization replaces the WHOLE
 * page — including the home page, which previews the three most recent charts
 * (GH #289). A chart renders data of unknown provenance (an encoding an agent
 * authored, a spec from an older schema, a column that no longer exists), so a
 * render throw is a state this surface must degrade through, not a state that
 * should take its neighbours with it.
 *
 * Deliberately a class component: `componentDidCatch` / `getDerivedStateFromError`
 * have no hook equivalent — React offers no functional error boundary.
 */

interface VisualizationErrorBoundaryProps {
  children: ReactNode;
  /**
   * Rendered in place of the failed chart. Defaults to the inline broken-card
   * message below. Callers that already pass a compact fallback for other
   * terminal states (e.g. a chart-type icon) can reuse it here.
   */
  fallback?: ReactNode;
  /**
   * Remounting key. When it changes, the boundary clears its error and retries
   * the children — a chart whose encoding was just fixed must recover without a
   * page reload.
   */
  resetKey?: string;
}

interface VisualizationErrorBoundaryState {
  error: Error | undefined;
  /** The resetKey this state was last reconciled against. */
  resetKey: string | undefined;
}

function BrokenVisualizationCard() {
  return (
    <div
      role="alert"
      className="flex h-full w-full flex-col items-center justify-center gap-1 bg-neutral-bg-muted/50 px-3 py-2 text-center"
    >
      <span className="text-xs font-medium text-neutral-fg">
        Can&apos;t display this chart
      </span>
      <span className="text-xs text-neutral-fg-subtle">
        Its configuration is invalid.
      </span>
    </div>
  );
}

export class VisualizationErrorBoundary extends Component<
  VisualizationErrorBoundaryProps,
  VisualizationErrorBoundaryState
> {
  override state: VisualizationErrorBoundaryState = {
    error: undefined,
    resetKey: undefined,
  };

  static getDerivedStateFromError(
    error: Error,
  ): Partial<VisualizationErrorBoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(
    props: VisualizationErrorBoundaryProps,
    state: VisualizationErrorBoundaryState,
  ): Partial<VisualizationErrorBoundaryState> | null {
    // Only a CHANGE of resetKey clears the error. Re-running with the same key
    // must keep it, or the boundary would re-render the throwing child on
    // every parent update and loop.
    if (props.resetKey !== state.resetKey) {
      return { resetKey: props.resetKey, error: undefined };
    }
    return null;
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The boundary swallows the throw for the user; the operator still needs
    // it. Nothing else logs this — React's own logging stops at the boundary.
    console.error("Visualization failed to render", error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return this.props.fallback ?? <BrokenVisualizationCard />;
    }
    return this.props.children;
  }
}
