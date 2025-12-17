"use client";

import { memo, useState, useMemo, useCallback } from "react";
import {
  Section,
  ItemList,
  VirtualTable,
  JoinTypeIcon,
  type ListItem,
  type ItemAction,
} from "@dashframe/ui";
import { Plus, Database, X } from "@dashframe/ui/icons";
import { JoinFlowModal } from "@/components/visualizations/JoinFlowModal";
import { useDataFrames, useInsightMutations } from "@dashframe/core";
import { useInsightPagination } from "@/hooks/useInsightPagination";
import type { DataTable, Insight } from "@dashframe/types";

interface DataModelSectionProps {
  insight: Insight;
  dataTable: DataTable;
  allDataTables: DataTable[];
  combinedFieldCount: number;
}

/**
 * DataModelSection - Unified section showing data sources + preview
 *
 * Combines the functionality of DataSourcesSection and DataPreviewSection:
 * - Shows base table + joined tables with "Add join" action
 * - Shows preview table with combined/joined data
 * - Displays combined row count and field count
 *
 * Uses useInsightPagination with showModelPreview=true to display
 * full joined data without aggregations/filters.
 *
 * Memoized to prevent re-renders when unrelated data changes.
 */
export const DataModelSection = memo(function DataModelSection({
  insight,
  dataTable,
  allDataTables,
  combinedFieldCount,
}: DataModelSectionProps) {
  const [isJoinFlowOpen, setIsJoinFlowOpen] = useState(false);
  const { data: allDataFrameEntries = [] } = useDataFrames();
  const { update: updateInsight } = useInsightMutations();

  // Use insight pagination for joined data preview
  const { fetchData, totalCount, isReady } = useInsightPagination({
    insight,
    allDataTables,
    showModelPreview: true,
  });

  // Remove join handler
  const handleRemoveJoin = useCallback(
    async (joinIndex: number) => {
      if (!insight.joins) return;
      const updatedJoins = insight.joins.filter((_, idx) => idx !== joinIndex);
      await updateInsight(insight.id, { joins: updatedJoins });
    },
    [insight.joins, insight.id, updateInsight],
  );

  // Build ItemList items for tables
  const tableItems = useMemo<ListItem[]>(() => {
    // Get base table metadata
    const baseDataFrameEntry = dataTable?.dataFrameId
      ? allDataFrameEntries.find((e) => e.id === dataTable.dataFrameId)
      : undefined;
    const baseRowCount = baseDataFrameEntry?.rowCount ?? 0;
    const baseFieldCount = (dataTable.fields ?? []).filter(
      (f) => !f.name.startsWith("_"),
    ).length;

    // Base table item
    const baseItem: ListItem = {
      id: "base",
      title: dataTable.name,
      subtitle: `${baseRowCount.toLocaleString()} rows • ${baseFieldCount} fields`,
      badge: "base",
      icon: <Database className="h-4 w-4" />,
    };

    // Join items
    const joinItems: ListItem[] = (insight.joins || []).map((join, idx) => {
      const joinTable = allDataTables.find((t) => t.id === join.rightTableId);
      const joinDataFrameEntry = joinTable?.dataFrameId
        ? allDataFrameEntries.find((e) => e.id === joinTable.dataFrameId)
        : undefined;
      const joinRowCount = joinDataFrameEntry?.rowCount ?? 0;

      const actions: ItemAction[] = [
        {
          icon: X,
          label: "Remove join",
          onClick: () => handleRemoveJoin(idx),
          variant: "destructive",
        },
      ];

      return {
        id: join.rightTableId,
        title: joinTable?.name || "Unknown table",
        subtitle: `${join.type} join • ${joinRowCount.toLocaleString()} rows`,
        icon: <JoinTypeIcon type={join.type} className="h-4 w-4" />,
        actions,
      };
    });

    return [baseItem, ...joinItems];
  }, [
    dataTable,
    allDataFrameEntries,
    insight.joins,
    allDataTables,
    handleRemoveJoin,
  ]);

  const displayRowCount = totalCount || 0;

  return (
    <>
      <Section
        title="Data model"
        description={`${displayRowCount.toLocaleString()} rows • ${combinedFieldCount} fields`}
        actions={[
          {
            label: "Add join",
            icon: Plus,
            onClick: () => setIsJoinFlowOpen(true),
            variant: "outline",
          },
        ]}
        isLoading={!isReady}
        loadingHeight={360}
      >
        {/* Table list */}
        <ItemList
          items={tableItems}
          onSelect={() => {}}
          orientation="horizontal"
          gap={12}
          itemWidth={260}
          emptyMessage="No data sources"
          emptyIcon={<Database className="h-8 w-8" />}
        />

        {/* Preview table */}
        <div className="mt-4">
          <VirtualTable onFetchData={fetchData} height={260} compact />
        </div>
      </Section>

      <JoinFlowModal
        insight={insight}
        dataTable={dataTable}
        isOpen={isJoinFlowOpen}
        onOpenChange={setIsJoinFlowOpen}
      />
    </>
  );
});
