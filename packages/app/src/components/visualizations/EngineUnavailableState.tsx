import { ErrorState } from "@wystack/ui";
import { useCallback } from "react";

/**
 * EngineUnavailableState — persistent inline affordance shown where a chart
 * would render when the data engine can't be reached.
 *
 * Engine-unreachable is a PERSISTENT condition: charts stay broken until the
 * user reloads to reconnect. A fading toast is the wrong surface for a state
 * that doesn't resolve on its own — this stays visible and carries the action
 * (Reload) that actually fixes it.
 *
 * Two conditions fold into this one surface because they look identical to the
 * user — there are no charts, and reloading is the fix:
 *   - native engine unreachable (connector=null, engineError set), and
 *   - the visualization provider failing to initialize.
 *
 * Copy is plain-language by intent: users have a CHARTS mental model, not an
 * "engine" one. No implementation terms ("native", "WASM", "Mosaic"), no raw
 * runtime strings (DESIGN.md — "Raw runtime errors in user-facing UI").
 *
 * Reload runs the renderer's reload path (window.location.reload), which
 * re-runs bootstrap() in main.tsx and re-establishes the loopback connection.
 */
export function EngineUnavailableState({ className }: { className?: string }) {
  const handleReload = useCallback(() => {
    window.location.reload();
  }, []);

  return (
    <ErrorState
      size="sm"
      title="Charts can't load right now"
      description="The data engine isn't responding. Reload to reconnect."
      retryAction={{ label: "Reload", onClick: handleReload }}
      className={className}
    />
  );
}
