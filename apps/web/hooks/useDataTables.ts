import { useMemo } from "react";

const getFieldCount = (table: any): number => {
  // Prefer discovered source schema columns (no system fields)
  if (table?.sourceSchema?.columns?.length) {
    return table.sourceSchema.columns.length;
  }

  // Backwards compatibility for sourceSchema.fields shape
  if (table?.sourceSchema?.fields?.length) {
    return table.sourceSchema.fields.length;
  }

  // Fallback to user-defined fields, skipping system fields
  if (table?.fields?.length) {
    return table.fields.filter((field: any) => !field.name?.startsWith("_")).length;
  }

  return 0;
};

export interface DataTableInfo {
  tableId: string;
  tableName: string;
  sourceId: string;
  sourceName: string;
  fieldCount: number;
  isLocal: boolean;
}

/**
 * Aggregates data tables from local data sources.
 *
 * Transforms the nested DataSource → DataTable structure into a flat
 * list of tables with metadata for easy rendering.
 *
 * Optionally filters tables by source ID.
 *
 * @example
 * ```tsx
 * const { localSources } = useLocalStoreHydration();
 * const { allDataTables, getTablesForSource } = useDataTables(localSources);
 *
 * // All tables
 * return <div>{allDataTables.length} total tables</div>;
 *
 * // Tables for specific source
 * const sourceTables = getTablesForSource('source-id');
 * ```
 */
export function useDataTables(localSources: any[], filterSourceId?: string | null) {
  const allDataTables = useMemo(() => {
    const tables: DataTableInfo[] = [];

    for (const source of localSources) {
      // Skip if filtering by source and this isn't the one
      if (filterSourceId && source.id !== filterSourceId) {
        continue;
      }

      const dataTables = Array.from(source.dataTables?.values?.() ?? []);
      for (const table of dataTables) {
        const localTable = table as any;
        tables.push({
          tableId: localTable.id,
          tableName: localTable.name,
          sourceId: source.id,
          sourceName: source.name,
          fieldCount: getFieldCount(localTable),
          isLocal: true,
        });
      }
    }

    return tables;
  }, [localSources, filterSourceId]);

  // Helper to get tables for a specific source
  const getTablesForSource = useMemo(
    () => (sourceId: string) => {
      return allDataTables.filter((table) => table.sourceId === sourceId);
    },
    [allDataTables]
  );

  return {
    allDataTables,
    getTablesForSource,
  };
}
