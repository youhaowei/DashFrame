import { ConnectorIcon } from "@/components/data-sources/renderers/ConnectorIcon";
import { getConnectorById } from "@/lib/connectors/registry";
import { useDataSources, useDataTables } from "@dashframe/core";
import type { AnyConnector } from "@dashframe/engine";
import { ItemSelector, type SelectableItem } from "@dashframe/ui";
import { Link } from "@tanstack/react-router";
import { Button, Surface, type ItemAction } from "@wystack/ui";
import { ChartIcon, DatabaseIcon, PlusIcon } from "@wystack/ui-icons";
import { useMemo } from "react";

/**
 * `ItemSelector` expects a React component type for an item's icon, but
 * connectors expose their icon as an SVG string. This bridges the two by
 * wrapping the SVG in a `ConnectorIcon`-rendering component.
 *
 * The wrapper is cached per connector instance so the same component identity
 * is returned on every render. Without a stable identity React would treat the
 * icon as a new component type each render and remount it. Connectors are boot-
 * time singletons, so keying on the instance is safe and the cache never grows
 * unbounded.
 */
const iconComponentCache = new WeakMap<
  AnyConnector,
  React.ComponentType<{ className?: string }>
>();

function connectorIconComponent(
  connector: AnyConnector,
): React.ComponentType<{ className?: string }> {
  const cached = iconComponentCache.get(connector);
  if (cached) return cached;

  const svg = connector.icon;
  function SvgIcon({ className }: { className?: string }) {
    return <ConnectorIcon svg={svg} className={className} />;
  }
  SvgIcon.displayName = `ConnectorIcon(${connector.id})`;
  iconComponentCache.set(connector, SvgIcon);
  return SvgIcon;
}

interface DataSourceSelectorProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreateClick: () => void;
}

export function DataSourceSelector({
  selectedId,
  onSelect,
  onCreateClick,
}: DataSourceSelectorProps) {
  const { data: dataSources, isLoading } = useDataSources();
  const { data: allTables } = useDataTables();

  // Sort data sources by creation time (newest first)
  const sortedSources = useMemo(
    () => [...(dataSources ?? [])].sort((a, b) => b.createdAt - a.createdAt),
    [dataSources],
  );

  // Count tables per data source
  const tableCountBySource = useMemo(() => {
    const counts = new Map<string, number>();
    for (const table of allTables ?? []) {
      counts.set(table.dataSourceId, (counts.get(table.dataSourceId) ?? 0) + 1);
    }
    return counts;
  }, [allTables]);

  const items: SelectableItem[] = useMemo(() => {
    return sortedSources.map((source) => {
      const isActive = source.id === selectedId;
      const tableCount = tableCountBySource.get(source.id) ?? 0;

      const connector = getConnectorById(source.type);
      const isFileSource = connector?.sourceType === "file";

      // Icon comes from the registry — any registered connector kind renders its
      // own icon with no per-type branching here.
      const icon = connector ? connectorIconComponent(connector) : undefined;

      const itemLabel = isFileSource ? "file" : "table";
      const itemLabelPlural = isFileSource ? "files" : "tables";
      const countLabel = tableCount === 1 ? itemLabel : itemLabelPlural;
      const metadata = connector ? `${tableCount} ${countLabel}` : "";

      return {
        id: source.id,
        label: source.name,
        active: isActive,
        icon,
        metadata,
      };
    });
  }, [sortedSources, selectedId, tableCountBySource]);

  const actions: ItemAction[] = useMemo(
    () => [
      {
        label: "Visualizations",
        variant: "outline",
        href: "/",
        icon: ChartIcon,
        tooltip: "View visualizations",
      },
      {
        label: "New Data Source",
        onClick: onCreateClick,
        icon: PlusIcon,
      },
    ],
    [onCreateClick],
  );

  if (isLoading) {
    return (
      <Surface elevation="raised" className="p-6">
        <p className="text-sm text-neutral-fg-subtle">
          Preparing data sources…
        </p>
      </Surface>
    );
  }

  if (sortedSources.length === 0) {
    return (
      <Surface elevation="inset" className="p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-palette-primary/15 text-palette-primary">
          <DatabaseIcon className="h-12 w-12" />
        </div>
        <h2 className="text-lg font-semibold text-neutral-fg">
          Add your first data source
        </h2>
        <p className="mt-2 text-sm text-neutral-fg-subtle">
          Upload CSV files or connect to Notion to start analyzing your data.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button
            label="View Visualizations"
            variant="outline"
            asChild
            size="sm"
          >
            <Link to="/">View Visualizations</Link>
          </Button>
          <Button
            label="Add Data Source"
            onClick={onCreateClick}
            size="sm"
            icon={PlusIcon}
          />
        </div>
      </Surface>
    );
  }

  return (
    <ItemSelector
      title="Data Sources"
      items={items}
      onItemSelect={onSelect}
      actions={actions}
    />
  );
}
