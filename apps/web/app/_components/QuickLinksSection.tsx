"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Sparkles, Database, ItemList } from "@dashframe/ui";

import { useVisualizationsStore } from "@/lib/stores/visualizations-store";
import { useInsightsStore } from "@/lib/stores/insights-store";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import { useStoreQuery } from "@/hooks/useStoreQuery";

/**
 * QuickLinksSection - Navigation links to main app sections
 *
 * Self-contained section that fetches counts from all stores.
 */
export function QuickLinksSection() {
    const router = useRouter();

    const { data: visualizations } = useStoreQuery(
        useVisualizationsStore,
        (state) => state.getAll(),
    );
    const { data: insights } = useStoreQuery(useInsightsStore, (state) =>
        state.getAll(),
    );
    const { data: dataSources } = useStoreQuery(useDataSourcesStore, (state) =>
        state.getAll(),
    );

    const quickLinks = useMemo(
        () => [
            {
                id: "visualizations",
                title: "All Visualizations",
                subtitle: `${visualizations.length} total`,
                icon: BarChart3,
            },
            {
                id: "insights",
                title: "All Insights",
                subtitle: `${insights.length} total`,
                icon: Sparkles,
            },
            {
                id: "data-sources",
                title: "Data Sources",
                subtitle: `${dataSources.length} connected`,
                icon: Database,
            },
        ],
        [visualizations.length, insights.length, dataSources.length],
    );

    return (
        <div>
            <h2 className="mb-4 text-xl font-semibold">Quick Links</h2>
            <ItemList
                items={quickLinks}
                onSelect={(id) => router.push(`/${id}`)}
                orientation="grid"
                gap={12}
            />
        </div>
    );
}
