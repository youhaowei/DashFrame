import { ConnectorIcon } from "@/components/data-sources/renderers/ConnectorIcon";
import { SavedMetricShelfRow } from "@/components/shelf/SavedMetricShelfRow";
import type { AnyConnector } from "@dashframe/engine";
import type { DataSource, DataTable } from "@dashframe/types";
import { OverlayScrollArea, WorkbenchPaneHeader } from "@dashframe/ui";
import { DatabaseIcon } from "@wystack/ui-react/icons";
import type { ReactNode } from "react";

const DATE_TIME = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatTime(epochMs: number | undefined): string | null {
  return epochMs ? DATE_TIME.format(epochMs) : null;
}

/** A label above its value, as every pane control reads. */
function Setting({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-[11px] text-neutral-fg-subtle">{label}</dt>
      <dd className="min-w-0 text-xs break-words text-neutral-fg">
        {children}
      </dd>
    </div>
  );
}

/** What is stored to reach the source, never the stored value itself. */
function describeCredentials(
  source: DataSource,
  connector: AnyConnector | null | undefined,
): string {
  if (connector?.authKind === "oauth") return "Account sign-in";
  if (source.config.hasApiKey) return "API key stored";
  if (source.config.hasConnectionString) return "Connection string stored";
  return "None stored";
}

export interface SourceConfigPaneProps {
  source: DataSource;
  /** Undefined until the connector registry hydrates. */
  connector: AnyConnector | null | undefined;
  /** The open table, for its file or refresh history. */
  table: DataTable | null;
  /** When the open table's data was last loaded. */
  lastRefreshedAt?: number;
}

/**
 * The left pane of a data source: how the source is reached and kept current.
 * Only facts the source records are shown; a row with nothing behind it is
 * left out rather than filled with a placeholder.
 */
export function SourceConfigPane({
  source,
  connector,
  table,
  lastRefreshedAt,
}: SourceConfigPaneProps) {
  const isFile = connector?.sourceType === "file";
  const defaultSchema =
    typeof source.config.defaultSchema === "string"
      ? source.config.defaultSchema
      : null;
  const refreshedAt = formatTime(lastRefreshedAt ?? table?.lastFetchedAt);

  return (
    <div className="flex h-full flex-col bg-neutral-bg text-xs">
      <WorkbenchPaneHeader title="Source">{null}</WorkbenchPaneHeader>
      <OverlayScrollArea className="min-h-0 flex-1">
        <dl className="space-y-4 px-3.5 pb-4">
          <Setting label="Connection">
            <span className="flex items-center gap-1.5">
              {connector ? (
                <ConnectorIcon
                  svg={connector.icon}
                  className="h-3.5 w-3.5 shrink-0"
                />
              ) : (
                <DatabaseIcon
                  aria-hidden
                  className="h-3.5 w-3.5 shrink-0 text-neutral-fg-subtle"
                />
              )}
              {connector?.name ?? source.type}
            </span>
          </Setting>

          {!isFile && (
            <Setting label="Credentials">
              {describeCredentials(source, connector)}
            </Setting>
          )}

          {defaultSchema && (
            <Setting label="Default schema">{defaultSchema}</Setting>
          )}

          {isFile && table && (
            <Setting label="File">
              <span className="font-mono">{table.table}</span>
            </Setting>
          )}

          {isFile && table && (
            <Setting label="Added">{formatTime(table.createdAt)}</Setting>
          )}

          {!isFile && table && (
            <Setting label="Refresh">
              {refreshedAt ? `Manual · last ${refreshedAt}` : "Manual"}
            </Setting>
          )}

          {!isFile && (
            <Setting label="Connected">{formatTime(source.createdAt)}</Setting>
          )}
        </dl>
        {table && (table.metrics?.length ?? 0) > 0 && (
          <section aria-label="Saved metrics" className="space-y-1 px-3.5 pb-4">
            <h3 className="text-[11px] text-neutral-fg-subtle">
              Saved metrics
            </h3>
            {table.metrics!.map((metric) => (
              <SavedMetricShelfRow key={metric.id} metric={metric} />
            ))}
          </section>
        )}
      </OverlayScrollArea>
    </div>
  );
}
