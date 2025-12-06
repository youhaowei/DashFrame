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

  // Handle container resize
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      if (!viewRef.current) return;

      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          try {
            // Explicitly set dimensions and re-run
            viewRef.current
              .width(Math.floor(width))
              .height(Math.floor(height))
              .run();
          } catch (e) {
            console.warn("Error resizing chart:", e);
          }
        }
      }
    });

    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn("h-full min-h-0 w-full flex-1 overflow-hidden", className)}
    />
  );
}
