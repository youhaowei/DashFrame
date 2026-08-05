import { JoinFlowModal } from "@/components/visualizations/JoinFlowModal";
import { api } from "@/wystack/api";
import type { DataTable, Field, Insight } from "@dashframe/types";
import { cmd } from "@dashframe/types";
import { JoinTypeIcon } from "@dashframe/ui";
import { useMutation, useQuery } from "@wystack/client";
import {
  ItemList,
  Section,
  type ItemCardAction,
  type ListItem,
} from "@wystack/ui-react";
import { CloseIcon, DatabaseIcon, PlusIcon } from "@wystack/ui-react/icons";
import { memo, useCallback, useMemo, useState } from "react";

interface DataSourcesSectionProps {
  insight: Insight;
  dataTable: DataTable;
  allDataTables: DataTable[];
  allTableFields: Field[];
}

/**
 * DataSourcesSection - Shows base table and joined tables
 *
 * Matches the original InsightConfigureTab layout with horizontal ItemList
 * Memoized to prevent re-renders when unrelated data changes.
 */
export const DataSourcesSection = memo(function DataSourcesSection({
  insight,
  dataTable,
  allDataTables,
  allTableFields,
}: DataSourcesSectionProps) {
  const [isJoinFlowOpen, setIsJoinFlowOpen] = useState(false);
  const { data: allDataFrameEntries = [] } = useQuery(api.listDataFrames);
  const { mutateAsync: commitBatch } = useMutation(api.commitBatch);

  // Remove join handler
  const handleRemoveJoin = useCallback(
    async (joinIndex: number) => {
      if (!insight.joins) return;
      await commitBatch({
        commands: [cmd("RemoveJoin", { id: insight.id, joinIndex })],
      });
    },
    [insight.joins, insight.id, commitBatch],
  );

  // Build ItemList items for Data Sources section
  const items = useMemo<ListItem[]>(() => {
    // Get base table metadata
    const baseDataFrameEntry = dataTable?.dataFrameId
      ? allDataFrameEntries.find((e) => e.id === dataTable.dataFrameId)
      : undefined;
    const baseRowCount = baseDataFrameEntry?.rowCount ?? 0;
    const baseFieldCount = allTableFields.length;

    // Base table item
    const baseItem: ListItem = {
      id: "base",
      title: dataTable.name,
      subtitle: `${baseRowCount.toLocaleString()} rows • ${baseFieldCount} fields`,
      badge: "base",
      icon: <DatabaseIcon className="h-4 w-4" />,
    };

    // Join items
    const joinItems: ListItem[] = (insight.joins || []).map((join, idx) => {
      const joinTable = allDataTables.find((t) => t.id === join.rightTableId);
      const joinDataFrameEntry = joinTable?.dataFrameId
        ? allDataFrameEntries.find((e) => e.id === joinTable.dataFrameId)
        : undefined;
      const joinRowCount = joinDataFrameEntry?.rowCount ?? 0;

      const actions: ItemCardAction[] = [
        {
          icon: CloseIcon,
          label: "Remove join",
          onClick: () => handleRemoveJoin(idx),
          color: "danger",
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
    allTableFields.length,
    insight.joins,
    allDataTables,
    handleRemoveJoin,
  ]);

  return (
    <>
      <Section
        title="Data sources"
        description="Tables used in this insight"
        actions={[
          {
            label: "Add join",
            icon: PlusIcon,
            onClick: () => setIsJoinFlowOpen(true),
            variant: "outline",
          },
        ]}
      >
        <ItemList
          items={items}
          onSelect={() => {}}
          orientation="horizontal"
          gap={12}
          itemWidth={260}
          emptyMessage="No data sources"
          emptyIcon={<DatabaseIcon className="h-8 w-8" />}
        />
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
