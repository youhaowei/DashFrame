"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";

import { Chart } from "@dashframe/ui/icons";
import { DashboardSection } from "./DashboardSection";
import { VisualizationPreview } from "@/components/visualizations/VisualizationPreview";
import { useVisualizationsStore } from "@/lib/stores/visualizations-store";
import { useStoreQuery } from "@/hooks/useStoreQuery";

/**
 * RecentVisualizationsSection - Displays the 3 most recent visualizations
 *
 * Self-contained section that fetches its own data from the visualizations store.
 */
export function RecentVisualizationsSection() {
    const router = useRouter();

    const { data: visualizations } = useStoreQuery(
        useVisualizationsStore,
        (state) => state.getAll(),
    );

    const recentVisualizations = useMemo(() => {
        return [...visualizations]
            .sort(
                (a, b) =>
                    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
            )
            .slice(0, 3)
            .map((viz) => ({
                id: viz.id,
                title: viz.name,
                subtitle: `Created ${new Date(viz.createdAt).toLocaleDateString(
                    "en-US",
                    { month: "short", day: "numeric" },
                )}`,
                preview: <VisualizationPreview visualization={viz} height={180} />,
            }));
    }, [visualizations]);

    return (
        <DashboardSection
            title="Recent Visualizations"
            icon={Chart}
            viewAllHref="/visualizations"
            items={recentVisualizations}
            onItemSelect={(id) => router.push(`/visualizations/${id}`)}
            gap={16}
        />
    );
}
