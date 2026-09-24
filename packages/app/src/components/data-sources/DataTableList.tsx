import { ItemCard } from "@wystack/ui-react";
import { DatabaseIcon } from "@wystack/ui-react/icons";

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
 * Used by the data picker to show the tables a chart can start from.
 *
 * @example
 * ```tsx
 * const { data: allDataTables = [] } = useQuery(api.listDataTables, {
 *   args: { dataSourceId },
 * });
 * <DataTableList
 *   tables={allDataTables}
 *   onTableClick={(tableId, tableName) => console.log(tableId, tableName)}
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
