"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "@dashframe/ui/icons";

import { DashboardSection } from "./DashboardSection";
import { useInsightsStore } from "@/lib/stores/insights-store";
import { useStoreQuery } from "@/hooks/useStoreQuery";

/**
 * RecentInsightsSection - Displays the 3 most recent insights
 *
 * Self-contained section that fetches its own data from the insights store.
 */
export function RecentInsightsSection() {
    const router = useRouter();

    const { data: insights } = useStoreQuery(useInsightsStore, (state) =>
        state.getAll(),
    );

    const recentInsights = useMemo(() => {
        return [...insights]
            .sort(
                (a, b) =>
                    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
            )
            .slice(0, 3)
            .map((insight) => ({
                id: insight.id,
                title: insight.name,
                subtitle: `${insight.metrics?.length || 0} metric${insight.metrics?.length !== 1 ? "s" : ""}`,
                badge: insight.baseTable?.selectedFields.length
                    ? `${insight.baseTable.selectedFields.length} fields`
                    : undefined,
            }));
    }, [insights]);

    return (
        <DashboardSection
            title="Recent Insights"
            icon={Sparkles}
            viewAllHref="/insights"
            items={recentInsights}
            onItemSelect={(id) => router.push(`/insights/${id}`)}
        />
    );
}
