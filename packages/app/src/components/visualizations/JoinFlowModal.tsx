import { DataPickerModal } from "@/components/data-sources/DataPickerModal";
import type { DataTable, Insight } from "@dashframe/types";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { joinTableConfigurationLink } from "./join-navigation";

interface JoinFlowModalProps {
  insight: Insight;
  dataTable: DataTable;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  reportId?: string;
}

/**
 * JoinFlowModal - Table Selection Modal for Joins
 *
 * Uses the unified DataPickerModal to allow users to select a table to join
 * with their current insight. After selection, navigates to the join
 * configuration page.
 *
 * The current insight and its base table are excluded from selection
 * (you can't join a table with itself).
 */
export function JoinFlowModal({
  insight,
  dataTable,
  isOpen,
  onOpenChange,
  reportId,
}: JoinFlowModalProps) {
  const navigate = useNavigate();

  // When selecting a table, navigate to join configuration
  const handleTableSelect = useCallback(
    (tableId: string, _tableName: string) => {
      onOpenChange(false);
      navigate(
        joinTableConfigurationLink(insight.id, tableId, reportId) as never,
      );
    },
    [insight.id, navigate, onOpenChange, reportId],
  );

  return (
    <DataPickerModal
      isOpen={isOpen}
      onClose={() => onOpenChange(false)}
      title="Join with another dataset"
      onTableSelect={handleTableSelect}
      excludeTableIds={[dataTable.id]} // Can't join with own base table
      showInsights={false}
    />
  );
}
