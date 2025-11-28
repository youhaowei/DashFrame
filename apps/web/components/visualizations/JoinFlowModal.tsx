"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { DataPickerModal } from "@/components/data-sources/DataPickerModal";
import type { Insight, DataTable } from "@/lib/stores/types";

interface JoinFlowModalProps {
  insight: Insight;
  dataTable: DataTable;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

/**
 * JoinFlowModal - Table Selection Modal for Joins
 *
 * Uses the unified DataPickerModal to allow users to select a table or insight
 * to join with their current insight. After selection, navigates to the
 * join configuration page.
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
  const router = useRouter();

  // When selecting an insight, use its DataFrame for the join
  const handleInsightSelect = useCallback(
    (insightId: string, _insightName: string) => {
      onOpenChange(false);
      // Navigate to join page with insight's DataFrame
      router.push(`/insights/${insight.id}/join/insight/${insightId}`);
    },
    [insight.id, router, onOpenChange],
  );

  // When selecting a table, navigate to join configuration
  const handleTableSelect = useCallback(
    (tableId: string, _tableName: string) => {
      onOpenChange(false);
      router.push(`/insights/${insight.id}/join/${tableId}`);
    },
    [insight.id, router, onOpenChange],
  );

  return (
    <DataPickerModal
      isOpen={isOpen}
      onClose={() => onOpenChange(false)}
      title="Join with another dataset"
      onInsightSelect={handleInsightSelect}
      onTableSelect={handleTableSelect}
      excludeInsightIds={[insight.id]} // Can't join with self
      excludeTableIds={[dataTable.id]} // Can't join with own base table
      showInsights={true}
      showNotion={false}
    />
  );
}
