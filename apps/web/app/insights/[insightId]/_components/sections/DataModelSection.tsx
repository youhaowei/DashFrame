"use client";

import { memo, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Section,
  ItemList,
  JoinTypeIcon,
  type ListItem,
  type ItemAction,
} from "@dashframe/ui";
import {
  PlusIcon,
  DatabaseIcon,
  CloseIcon,
  ExternalLinkIcon,
  CloudIcon,
  FileIcon,
  TableIcon,
} from "@dashframe/ui/icons";
import { JoinFlowModal } from "@/components/visualizations/JoinFlowModal";
import {
  useDataFrames,
  useInsightMutations,
  useDataSources,
} from "@dashframe/core";
import { useConfirmDialogStore } from "@/lib/stores/confirm-dialog-store";
import type { DataTable, Insight } from "@dashframe/types";

interface DataModelSectionProps {
  insight: Insight;
  dataTable: DataTable;
  allDataTables: DataTable[];
  combinedFieldCount: number;
}

/**
 * DataModelSection - Section showing data sources (base table + joins)
 *
 * User-friendly display of:
 * - Primary data table with source info and record count
 * - Combined tables with relationship type
 * - Quick navigation to source management
 *
 * Memoized to prevent re-renders when unrelated data changes.
 */

/**
 * Get icon for data source type (card icon)
 */
function getSourceTypeIcon(type: string) {
  switch (type) {
    case "notion":
      return <CloudIcon className="h-4 w-4" />;
    case "local":
      return <TableIcon className="h-4 w-4" />;
    default:
      return <DatabaseIcon className="h-4 w-4" />;
  }
}

/**
 * Get small inline icon for file type display in content
 */
function getFileTypeIcon(type: string) {
  switch (type) {
    case "notion":
      return <CloudIcon className="h-3 w-3" />;
    case "local":
      return <FileIcon className="h-3 w-3" />;
    default:
      return <DatabaseIcon className="h-3 w-3" />;
  }
}

/**
 * Get file name from table info, ensuring extension is visible
 * Truncates middle of name if too long, showing start...end.ext
 */
function getDisplayFileName(table: DataTable, maxLength = 24): string {
  // Use table.table (original identifier) or fall back to name
  const fullName = table.table || table.name;

  if (fullName.length <= maxLength) {
    return fullName;
  }

  // If it has an extension, preserve it and show start...end
  const lastDot = fullName.lastIndexOf(".");
  if (lastDot > 0) {
    const extension = fullName.slice(lastDot); // e.g., ".csv"
    const baseName = fullName.slice(0, lastDot);
    // Show first part + ... + last few chars + extension
    const availableLength = maxLength - extension.length - 3; // 3 for "..."
    if (availableLength > 6) {
      const startLength = Math.ceil(availableLength * 0.6);
      const endLength = availableLength - startLength;
      return (
        baseName.slice(0, startLength) +
        "..." +
        baseName.slice(-endLength) +
        extension
      );
    }
  }

  // No extension - show start...end
  const startLength = Math.ceil((maxLength - 3) * 0.6);
  const endLength = maxLength - 3 - startLength;
  return fullName.slice(0, startLength) + "..." + fullName.slice(-endLength);
}

export const DataModelSection = memo(function DataModelSection({
  insight,
  dataTable,
  allDataTables,
  combinedFieldCount,
}: DataModelSectionProps) {
  const router = useRouter();
  const [isJoinFlowOpen, setIsJoinFlowOpen] = useState(false);
  const { data: allDataFrameEntries = [] } = useDataFrames();
  const { data: allDataSources = [] } = useDataSources();
  const { update: updateInsight } = useInsightMutations();
  const { confirm } = useConfirmDialogStore();

  // Remove join handler - shows confirmation then removes
  const handleRemoveJoin = useCallback(
    (joinIndex: number, tableName: string) => {
      confirm({
        title: "Remove table",
        description: `Are you sure you want to remove "${tableName}" from the insight? This will remove the join relationship.`,
        confirmLabel: "Remove",
        variant: "destructive",
        onConfirm: async () => {
          if (!insight.joins) return;
          const updatedJoins = insight.joins.filter(
            (_, idx) => idx !== joinIndex,
          );
          await updateInsight(insight.id, { joins: updatedJoins });
        },
      });
    },
    [insight.joins, insight.id, updateInsight, confirm],
  );

  // Navigate to data source page for a table
  const handleOpenDataSource = useCallback(
    (sourceId: string | undefined) => {
      if (sourceId) {
        router.push(`/data-sources/${sourceId}`);
      }
    },
    [router],
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

    // Find the data source for base table
    const baseDataSource = allDataSources.find(
      (s) => s.id === dataTable.dataSourceId,
    );

    // Base table actions - "View source" is clearer than "Open in data sources"
    const baseActions: ItemAction[] = dataTable.dataSourceId
      ? [
          {
            icon: ExternalLinkIcon,
            label: "View source",
            onClick: () => handleOpenDataSource(dataTable.dataSourceId),
          },
        ]
      : [];

    // Base table item - using native badge prop for inline display
    const baseItem: ListItem = {
      id: "base",
      title: dataTable.name,
      icon: baseDataSource ? (
        getSourceTypeIcon(baseDataSource.type)
      ) : (
        <DatabaseIcon className="h-4 w-4" />
      ),
      badge: "primary",
      actions: baseActions,
      content: (
        <div className="space-y-1.5 text-xs">
          <div className="text-muted-foreground">
            {baseRowCount.toLocaleString()} rows • {baseFieldCount} fields
          </div>
          <div className="text-muted-foreground/70 flex items-center gap-1">
            {baseDataSource && getFileTypeIcon(baseDataSource.type)}
            <span>{getDisplayFileName(dataTable)}</span>
          </div>
        </div>
      ),
    };

    // Join items - clean layout with badge in content
    const joinItems: ListItem[] = (insight.joins || []).map((join, idx) => {
      const joinTable = allDataTables.find((t) => t.id === join.rightTableId);
      const joinDataFrameEntry = joinTable?.dataFrameId
        ? allDataFrameEntries.find((e) => e.id === joinTable.dataFrameId)
        : undefined;
      const joinRowCount = joinDataFrameEntry?.rowCount ?? 0;
      const joinFieldCount = (joinTable?.fields ?? []).filter(
        (f) => !f.name.startsWith("_"),
      ).length;

      // Find data source for joined table
      const joinDataSource = joinTable
        ? allDataSources.find((s) => s.id === joinTable.dataSourceId)
        : undefined;

      // Capture values for action handlers (avoid creating closures over full objects)
      const tableName = joinTable?.name || "this table";
      const tableSourceId = joinTable?.dataSourceId;

      const actions: ItemAction[] = [
        ...(tableSourceId
          ? [
              {
                icon: ExternalLinkIcon,
                label: "View source",
                onClick: () => handleOpenDataSource(tableSourceId),
              },
            ]
          : []),
        {
          icon: CloseIcon,
          label: "Remove",
          onClick: () => handleRemoveJoin(idx, tableName),
          color: "danger" as const,
        },
      ];

      return {
        id: join.rightTableId,
        title: joinTable?.name || "Unknown table",
        icon: <JoinTypeIcon type={join.type} className="h-4 w-4" />,
        badge: `${join.type} join`,
        actions,
        content: (
          <div className="space-y-1.5 text-xs">
            <div className="text-muted-foreground">
              {joinRowCount.toLocaleString()} rows • {joinFieldCount} fields
            </div>
            {joinTable && joinDataSource && (
              <div className="text-muted-foreground/70 flex items-center gap-1">
                {getFileTypeIcon(joinDataSource.type)}
                <span>{getDisplayFileName(joinTable)}</span>
              </div>
            )}
          </div>
        ),
      };
    });

    return [baseItem, ...joinItems];
  }, [
    dataTable,
    allDataFrameEntries,
    allDataSources,
    insight.joins,
    allDataTables,
    handleRemoveJoin,
    handleOpenDataSource,
  ]);

  // User-friendly description
  const tableCount = tableItems.length;
  const sectionDescription =
    tableCount === 1
      ? `${combinedFieldCount} columns available`
      : `${tableCount} tables combined • ${combinedFieldCount} columns available`;

  return (
    <>
      <Section
        title="Data model"
        description={sectionDescription}
        actions={[
          {
            label: "Add join",
            icon: PlusIcon,
            onClick: () => setIsJoinFlowOpen(true),
            variant: "outlined",
          },
        ]}
      >
        <ItemList
          items={tableItems}
          orientation="horizontal"
          gap={12}
          itemWidth={320}
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
