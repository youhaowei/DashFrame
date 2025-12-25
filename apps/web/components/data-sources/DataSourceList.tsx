import { ItemCard, FileIcon } from "@dashframe/ui";

export interface DataSourceInfo {
  id: string;
  name: string;
  type: string;
  tableCount: number;
}

export interface DataSourceListProps {
  /**
   * List of data sources to display
   */
  sources: DataSourceInfo[];
  /**
   * ID of the currently selected source
   */
  selectedSourceId?: string | null;
  /**
   * Callback when a source is clicked
   */
  onSourceClick: (sourceId: string) => void;
}

/**
 * Displays a list of data sources as clickable cards.
 *
 * Shows the hierarchical relationship: sources contain tables.
 * Used to let users browse their data sources before drilling into tables.
 *
 * @example
 * ```tsx
 * const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
 *
 * <DataSourceList
 *   sources={localSources}
 *   selectedSourceId={selectedSourceId}
 *   onSourceClick={setSelectedSourceId}
 * />
 * ```
 */
export function DataSourceList({
  sources,
  selectedSourceId,
  onSourceClick,
}: DataSourceListProps) {
  return (
    <>
      {sources.map((source) => (
        <ItemCard
          key={source.id}
          icon={<FileIcon className="h-4 w-4" />}
          title={source.name}
          subtitle={`${source.tableCount} ${source.tableCount === 1 ? "table" : "tables"}`}
          badge={source.type === "local" ? "Local" : undefined}
          onClick={() => onSourceClick(source.id)}
          active={selectedSourceId === source.id}
        />
      ))}
    </>
  );
}
