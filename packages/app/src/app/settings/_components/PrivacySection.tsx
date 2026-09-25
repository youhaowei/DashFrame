import { queryStatus } from "@/data/query-status";
import { useUsageAnalyticsService } from "@/lib/usage-analytics";
import { api } from "@dashframe/convex-backend/api";
import {
  getFieldSensitivity,
  type DataSource,
  type DataTable,
} from "@dashframe/types";
import { Link } from "@tanstack/react-router";
import { ShieldIcon } from "@wystack/ui-react/icons";
import { useQuery_experimental as useQuery } from "convex/react";
import { useMemo } from "react";

import {
  SettingsField,
  SettingsListRow,
  SettingsLoadError,
  SettingsSection,
} from "./SettingsSection";

export interface SensitivityCounts {
  sensitive: number;
  unclassified: number;
  cleared: number;
}

export interface SourceSensitivity extends SensitivityCounts {
  source: Pick<DataSource, "id" | "name">;
}

/** Field classifications per data source, from the fields its tables own. */
export function rollUpSensitivity(
  sources: readonly Pick<DataSource, "id" | "name">[],
  tables: readonly Pick<DataTable, "dataSourceId" | "fields">[],
): SourceSensitivity[] {
  const bySource = new Map<string, SourceSensitivity>(
    sources.map((source) => [
      source.id,
      { source, sensitive: 0, unclassified: 0, cleared: 0 },
    ]),
  );
  for (const table of tables) {
    const row = bySource.get(table.dataSourceId);
    if (!row) continue;
    for (const field of table.fields ?? [])
      row[getFieldSensitivity(field)] += 1;
  }
  return [...bySource.values()].filter(
    (row) => row.sensitive + row.unclassified + row.cleared > 0,
  );
}

function countLine({ sensitive, unclassified, cleared }: SensitivityCounts) {
  return `${sensitive} sensitive · ${unclassified} unclassified · ${cleared} not sensitive`;
}

/**
 * How fields are classified across data sources, and what leaves the host.
 * "Restricted" is what every privacy check reads: any field not marked
 * not sensitive (see `isFieldRestricted`).
 */
export function PrivacySection({ mode }: { mode?: "local" | "hosted" }) {
  const analytics = useUsageAnalyticsService();
  const sourcesQuery = queryStatus(
    useQuery({ query: api.app.listDataSources, args: {} }),
  );
  const tablesQuery = queryStatus(
    useQuery({ query: api.app.listDataTables, args: {} }),
  );
  const sources = sourcesQuery.data;
  const tables = tablesQuery.data;
  const failed = sourcesQuery.isError || tablesQuery.isError;
  const rows = useMemo(
    () => (sources && tables ? rollUpSensitivity(sources, tables) : undefined),
    [sources, tables],
  );
  const restricted = rows?.reduce(
    (sum, row) => sum + row.sensitive + row.unclassified,
    0,
  );

  return (
    <SettingsSection
      id="privacy"
      title="Privacy"
      description="How fields are classified, and what leaves the host."
    >
      <div className="flex flex-col gap-5">
        {(mode || analytics) && (
          <div className="flex gap-2.5 rounded-[var(--inner-radius)] bg-neutral-bg-subtle p-3 text-sm">
            <ShieldIcon
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-neutral-fg-subtle"
            />
            <div className="min-w-0 space-y-1">
              <DeploymentStatement mode={mode} />
              {analytics && (
                <p className="text-neutral-fg-subtle">
                  This web app sends usage analytics to {analytics}: page views
                  and the text of what you click, and session recordings if that{" "}
                  {analytics} project turns them on.
                </p>
              )}
            </div>
          </div>
        )}

        <SettingsField
          label="Field classification"
          hint="Unclassified fields count as restricted, the same as sensitive ones, until you mark them not sensitive. Classification does not change how data is stored."
        >
          <ClassificationRollup
            failed={failed}
            rows={rows}
            restricted={restricted}
          />
        </SettingsField>
      </div>
    </SettingsSection>
  );
}

function ClassificationRollup({
  failed,
  rows,
  restricted = 0,
}: {
  failed: boolean;
  rows: SourceSensitivity[] | undefined;
  restricted?: number;
}) {
  // Convex keeps retrying a failed subscription on its own; there is nothing
  // for a retry button to ask for, so the line only says what happened.
  if (failed)
    return <SettingsLoadError message="Couldn't load field classification." />;
  if (rows === undefined)
    return <p className="text-sm text-neutral-fg-subtle">Loading…</p>;
  if (rows.length === 0)
    return (
      <p className="text-sm text-neutral-fg-subtle">
        No fields yet. Fields are classified on their data source once you
        import data.
      </p>
    );
  return (
    <>
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-neutral-fg-subtle">
        <strong className="text-[15px] font-semibold tabular-nums text-neutral-fg">
          {restricted}
        </strong>
        restricted {restricted === 1 ? "field" : "fields"} across {rows.length}{" "}
        data {rows.length === 1 ? "source" : "sources"}
      </p>
      <ul className="flex flex-col">
        {rows.map((row) => (
          <SettingsListRow
            key={row.source.id}
            name={row.source.name}
            meta={countLine(row)}
            actions={
              <Link
                to={`/data-sources/${row.source.id}` as never}
                className="rounded-sm px-2 py-1 text-xs text-neutral-fg-subtle transition-colors duration-150 hover:text-neutral-fg focus-visible:ring-2 focus-visible:ring-neutral-ring focus-visible:outline-none motion-reduce:transition-none"
                aria-label={`Review fields in ${row.source.name}`}
              >
                Review
              </Link>
            }
          />
        ))}
      </ul>
    </>
  );
}

/** What leaves the host, for the deployment kind the host reported. */
function DeploymentStatement({ mode }: { mode?: "local" | "hosted" }) {
  if (mode === "hosted")
    return (
      <>
        <p className="font-semibold text-neutral-fg">
          This workspace runs on operator-managed services
        </p>
        <p className="text-neutral-fg-subtle">
          Its data is stored on the operator's servers, its project metadata in
          an external Convex deployment, and sign-in is handled by WorkOS.
        </p>
      </>
    );
  if (mode === "local")
    return (
      <>
        <p className="font-semibold text-neutral-fg">
          Your data stays on the host you run
        </p>
        <p className="text-neutral-fg-subtle">
          Imported data and queries are stored and run by the DashFrame host.
          DashFrame contacts a connected service only to sign in to it and fetch
          that data source's data.
        </p>
      </>
    );
  // The host did not say which kind it is; claim nothing.
  return null;
}
