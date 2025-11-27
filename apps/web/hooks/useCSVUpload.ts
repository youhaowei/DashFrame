import { useState, useCallback } from "react";
import Papa, { type ParseError, type ParseResult } from "papaparse";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";

/**
 * Handles CSV file upload with parsing and error handling.
 *
 * Parses CSV files using PapaParse and processes them into local storage
 * via the handleLocalCSVUpload utility. Returns the data table ID for
 * further processing (e.g., creating an insight).
 *
 * @example
 * ```tsx
 * const { handleCSVUpload, error, clearError } = useCSVUpload();
 *
 * const onSuccess = (dataTableId) => {
 *   console.log('CSV uploaded:', dataTableId);
 * };
 *
 * return (
 *   <div>
 *     <input
 *       type="file"
 *       accept=".csv"
 *       onChange={(e) => {
 *         const file = e.target.files?.[0];
 *         if (file) handleCSVUpload(file, onSuccess);
 *       }}
 *     />
 *     {error && <Alert variant="destructive">{error}</Alert>}
 *   </div>
 * );
 * ```
 */
export function useCSVUpload() {
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleCSVUpload = useCallback(
    async (
      file: File,
      onSuccess?: (dataTableId: string, dataSourceId: string) => void
    ) => {
      setError(null);
      setIsUploading(true);

      Papa.parse(file, {
        dynamicTyping: false,
        skipEmptyLines: true,
        complete: async (result: ParseResult<string[]>) => {
          if (result.errors.length) {
            setError(
              result.errors.map((err: ParseError) => err.message).join("\n")
            );
            setIsUploading(false);
            return;
          }

          try {
            // Detect existing table with same file name
            const localSource = useDataSourcesStore.getState().getLocal();
            const duplicateTable = localSource
              ? Array.from(localSource.dataTables?.values?.() ?? []).find(
                  (table: any) =>
                    table.table === file.name ||
                    table.name === file.name.replace(/\.csv$/i, "")
                )
              : null;

            if (duplicateTable) {
              const shouldOverride = window.confirm(
                `"${file.name}" already exists. Replace the existing table with this file?`
              );

              if (!shouldOverride) {
                setIsUploading(false);
                return;
              }
            }

            const { handleLocalCSVUpload } = await import(
              "@/lib/local-csv-handler"
            );
            const { dataTableId, dataSourceId } = handleLocalCSVUpload(
              file,
              result.data,
              duplicateTable ? { overrideTableId: duplicateTable.id } : undefined
            );

            setIsUploading(false);
            onSuccess?.(dataTableId, dataSourceId);
          } catch (err) {
            setError(
              err instanceof Error ? err.message : "Failed to process CSV"
            );
            setIsUploading(false);
          }
        },
        error: (error: Error) => {
          setError(error.message);
          setIsUploading(false);
        },
      });
    },
    []
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    handleCSVUpload,
    error,
    isUploading,
    clearError,
  };
}
