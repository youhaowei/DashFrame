import { DataPickerModal } from "@/components/data-sources/DataPickerModal";
import type { DataTable, Insight } from "@dashframe/types";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";
import { joinTableConfigurationLink } from "./join-navigation";

interface JoinFlowModalProps {
  insight: Insight;
  dataTable: DataTable;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

/**
 * JoinFlowModal - Table Selection Modal for Joins
 *
 * Uses the unified DataPickerModal to allow users to select a table to join
 * with their current insight. After selection, navigates to the join
 * configuration page, which returns to the report and chart tab it was
 * opened from — both read from the current route.
 *
 * The current insight and its base table are excluded from selection
 * (you can't join a table with itself).
 */
export function JoinFlowModal({
  insight,
  dataTable,
  isOpen,
  onOpenChange,
}: JoinFlowModalProps) {
  const navigate = useNavigate();
  // Joins are configured from a report's chart tab, so the report and the
  // tab to come back to are the route's `/dashboards/$dashboardId?chart=`.
  // Anywhere else there is no report to return to, and picking a table only
  // closes the modal.
  const { dashboardId } = useParams({ strict: false });
  const { chart } = useSearch({ strict: false });

  const handleTableSelect = useCallback(
    (tableId: string, _tableName: string) => {
      onOpenChange(false);
      if (!dashboardId) return;
      navigate(
        joinTableConfigurationLink(
          dashboardId,
          insight.id,
          tableId,
          chart,
        ) as never,
      );
    },
    [chart, dashboardId, insight.id, navigate, onOpenChange],
  );

  return (
    <DataPickerModal
      isOpen={isOpen}
      onClose={() => onOpenChange(false)}
      title="Join with another dataset"
      onTableSelect={handleTableSelect}
      excludeTableIds={[dataTable.id]} // Can't join with own base table
    />
  );
}
