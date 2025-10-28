"use client";

import { useEffect, useRef } from "react";
import type { TopLevelSpec } from "vega-lite";

type VegaChartProps = {
    spec: TopLevelSpec;
};

export function VegaChart({ spec }: VegaChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);

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
            }).catch((error: Error) => {
                console.error("Error rendering chart:", error);
            });
        });

        return () => {
            cancelled = true;
            container.innerHTML = "";
        };
    }, [spec]);

    return <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden w-full h-full" />;
}

