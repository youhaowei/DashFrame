import { JoinFlowModal } from "@/components/visualizations/JoinFlowModal";
import { useConfirmDialogStore } from "@/lib/stores/confirm-dialog-store";
import { api } from "@dashframe/convex-backend/api";
import type { DataTable, Insight } from "@dashframe/types";
import { cmd } from "@dashframe/types";
import { WorkbenchAddRow, WorkbenchChip } from "@dashframe/ui";
import { useMutation } from "convex/react";
import { Table2 } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { toast } from "sonner";

interface TableItem {
  id: string;
  title: string;
  description: string;
  joinIndex?: number;
}

export const DataModelSection = memo(function DataModelSection({
  insight,
  dataTable,
  allDataTables,
  reportId,
}: {
  insight: Insight;
  dataTable: DataTable;
  allDataTables: DataTable[];
  reportId?: string;
}) {
  const [isJoinFlowOpen, setIsJoinFlowOpen] = useState(false);
  const commitBatch = useMutation(api.app.commitBatch);
  const { confirm } = useConfirmDialogStore();
  const removeJoin = useCallback(
    (joinIndex: number, tableName: string) => {
      confirm({
        title: "Remove table",
        description: `Are you sure you want to remove "${tableName}" from the insight? This will remove the join relationship.`,
        confirmLabel: "Remove",
        variant: "destructive",
        onConfirm: async () => {
          try {
            await commitBatch({
              commands: [cmd("RemoveJoin", { id: insight.id, joinIndex })],
            });
          } catch {
            toast.error("Couldn't remove the table");
          }
        },
      });
    },
    [commitBatch, confirm, insight.id],
  );
  const items: TableItem[] = [
    {
      id: "base",
      title: dataTable.name,
      description: "base",
    },
    ...(insight.joins ?? []).map((join, index) => {
      const table = allDataTables.find(
        (candidate) => candidate.id === join.rightTableId,
      );
      return {
        id: `${join.rightTableId}:${index}`,
        title: table?.name ?? "Unknown table",
        description: `${join.type} join on ${join.leftKey}`,
        joinIndex: index,
      };
    }),
  ];

  return (
    <>
      <div className="space-y-1">
        <div className="space-y-[3px]">
          {items.map((item) => (
            <WorkbenchChip
              key={item.id}
              icon={<Table2 className="h-3.5 w-3.5" />}
              title={item.title}
              description={item.description}
              removeLabel={
                item.joinIndex === undefined
                  ? undefined
                  : `Remove ${item.title}`
              }
              onRemove={
                item.joinIndex === undefined
                  ? undefined
                  : () => removeJoin(item.joinIndex!, item.title)
              }
            />
          ))}
        </div>
        <WorkbenchAddRow onClick={() => setIsJoinFlowOpen(true)}>
          Join a table
        </WorkbenchAddRow>
      </div>
      <JoinFlowModal
        insight={insight}
        dataTable={dataTable}
        isOpen={isJoinFlowOpen}
        onOpenChange={setIsJoinFlowOpen}
        reportId={reportId}
      />
    </>
  );
});
