"use client";

import { memo } from "react";
import { Section, VirtualTable } from "@dashframe/ui";
import { useDataFramePagination } from "@/hooks/useDataFramePagination";
import type { DataTable } from "@dashframe/types";

interface DataPreviewSectionProps {
  dataTable: DataTable;
  rowCount?: number;
  fieldCount?: number;
}

/**
 * DataPreviewSection - Shows VirtualTable with raw data preview
 *
 * Uses useDataFramePagination for efficient browsing of large datasets.
 * The insight engine handles the decision between base and joined data.
 *
 * Memoized to prevent re-renders when unrelated data changes.
 */
export const DataPreviewSection = memo(function DataPreviewSection({
  dataTable,
  rowCount = 0,
  fieldCount = 0,
}: DataPreviewSectionProps) {
  // Pagination hook for VirtualTable
  const { fetchData: fetchPreviewData, totalCount: previewTotalCount } =
    useDataFramePagination(dataTable?.dataFrameId);

  const displayRowCount = previewTotalCount || rowCount;

  return (
    <Section
      title="Data preview"
      description={`${displayRowCount.toLocaleString()} rows • ${fieldCount} fields`}
    >
      <VirtualTable onFetchData={fetchPreviewData} height={260} compact />
    </Section>
  );
});
