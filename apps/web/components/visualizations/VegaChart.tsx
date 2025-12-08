"use client";

import { useEffect, useRef } from "react";
import type { TopLevelSpec } from "vega-lite";

import { cn } from "@/lib/utils";

type VegaChartProps = {
  spec: TopLevelSpec;
  className?: string;
};

export function VegaChart({ spec, className }: VegaChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<any>(null);

  useEffect(() => {
    if (!spec || !containerRef.current) return;

    const container = containerRef.current;
    let cancelled = false;

    // Dynamically import vega-embed to avoid module-level Set objects
    import("vega-embed").then(({ default: embed }) => {
      if (cancelled || !container) return;

      // Let Vega-Embed handle responsive sizing via width/height: "container" in spec
      // Don't manually resize - it conflicts with Vega's internal ResizeObserver
      embed(container, spec, {
        actions: false,
        renderer: "canvas",
      })
        .then((result) => {
          if (cancelled) {
            result.view.finalize();
            return;
          }
          viewRef.current = result.view;
        })
        .catch((error: Error) => {
          console.error("Error rendering chart:", error);
        });
    });

    return () => {
      cancelled = true;
      if (viewRef.current) {
        viewRef.current.finalize();
        viewRef.current = null;
      }
      container.innerHTML = "";
    };
  }, [spec]);

  return (
    <div
      ref={containerRef}
      className={cn("h-full min-h-0 w-full overflow-hidden", className)}
    />
  );
}
