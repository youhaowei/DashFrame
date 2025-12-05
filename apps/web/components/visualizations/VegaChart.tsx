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
        .then((res) => {
          if (!cancelled) {
            viewRef.current = res.view;
          }
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
      className={cn("h-full min-h-0 w-full flex-1 overflow-hidden", className)}
    />
  );
}
