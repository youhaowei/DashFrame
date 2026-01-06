import { DatabaseIcon, ItemCard } from "@dashframe/ui";

/**
 * Display info for a data table in lists.
 */
export interface DataTableInfo {
  tableId: string;
  tableName: string;
  sourceId: string;
  sourceName: string;
  fieldCount: number;
  isLocal: boolean;
}

export interface DataTableListProps {
  /**
   * List of data tables to display
   */
  tables: DataTableInfo[];
  /**
   * Callback when a table is clicked
   */
  onTableClick: (tableId: string, tableName: string) => void;
}

/**
 * Displays a list of data tables as clickable cards.
 *
 * Used in both the home page and CreateVisualizationContent modal
 * to show existing tables that can be used to create insights.
 *
 * @example
 * ```tsx
 * const { allDataTables } = useDataTables(localSources);
 * const { createInsightFromTable } = useCreateInsight();
 *
 * <DataTableList
 *   tables={allDataTables}
 *   onTableClick={createInsightFromTable}
 * />
 * ```
 */
export function DataTableList({ tables, onTableClick }: DataTableListProps) {
  return (
    <>
      {tables.map((table) => (
        <ItemCard
          key={`${table.sourceId}-${table.tableId}`}
          icon={<DatabaseIcon className="h-4 w-4" />}
          title={table.tableName}
          subtitle={`${table.sourceName} • ${table.fieldCount} fields${table.isLocal ? " • Local" : ""}`}
          onClick={() => onTableClick(table.tableId, table.tableName)}
        />
      ))}
    </>
  );
}
