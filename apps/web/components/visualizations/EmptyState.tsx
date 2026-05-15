import { DataPickerContent } from "@/components/data-sources/DataPickerContent";
import { useCreateInsight } from "@/hooks/useCreateInsight";
import { SparklesIcon } from "@stdui/icons";
import { useCallback } from "react";

interface EmptyStateProps {
  onCreateClick: () => void;
}

export function EmptyState({ onCreateClick }: EmptyStateProps) {
  const { createInsightFromTable, createInsightFromInsight } =
    useCreateInsight();

  // Handle table selection - create insight and notify parent
  const handleTableSelect = useCallback(
    (tableId: string, tableName: string) => {
      createInsightFromTable(tableId, tableName);
      onCreateClick();
    },
    [createInsightFromTable, onCreateClick],
  );

  // Handle insight selection - create derived insight and notify parent
  const handleInsightSelect = useCallback(
    (insightId: string, insightName: string) => {
      createInsightFromInsight(insightId, insightName);
      onCreateClick();
    },
    [createInsightFromInsight, onCreateClick],
  );

  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-8">
      <div className="w-full max-w-2xl rounded-3xl border border-neutral-border/40 bg-neutral-bg/30 p-8 shadow-sm backdrop-blur-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-palette-primary/10 text-palette-primary">
            <SparklesIcon className="h-6 w-6" />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-fg">
            Create your first visualization
          </h2>
        </div>

        <DataPickerContent
          onTableSelect={handleTableSelect}
          onInsightSelect={handleInsightSelect}
          showInsights={true}
        />
      </div>
    </div>
  );
}
