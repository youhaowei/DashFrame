import { getConnectorById } from "@/lib/connectors/registry";
import { ItemCard } from "@wystack/ui";
import { ConnectorIcon } from "./renderers/ConnectorIcon";

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
      {sources.map((source) => {
        const connector = getConnectorById(source.type);
        const icon = connector ? (
          <ConnectorIcon svg={connector.icon} className="h-4 w-4" />
        ) : undefined;
        const isFileSource = connector?.sourceType === "file";
        const itemLabel = isFileSource ? "file" : "table";
        const itemLabelPlural = isFileSource ? "files" : "tables";
        const subtitle = `${source.tableCount} ${source.tableCount === 1 ? itemLabel : itemLabelPlural}`;

        return (
          <ItemCard
            key={source.id}
            icon={icon}
            title={source.name}
            subtitle={subtitle}
            onClick={() => onSourceClick(source.id)}
            active={selectedSourceId === source.id}
          />
        );
      })}
    </>
  );
}
