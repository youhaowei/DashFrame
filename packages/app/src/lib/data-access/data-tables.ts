import type {
  DataTable,
  Field,
  Metric,
  SourceSchema,
  UUID,
} from "@dashframe/types";

import { api } from "../../wystack/api";
import { getWyStackClient } from "../../wystack/client";

/**
 * Create a DataTable via the `CreateDataTable` command vocabulary — the
 * PRIMITIVE that does NOT auto-inject metrics. Callers are responsible for
 * passing explicit metrics (e.g. the default Count metric for file ingests).
 *
 * Use this instead of `addDataTable` when you want full control over the
 * metrics list — the legacy `addDataTable` mutation silently prepends a Count
 * metric via `withDefaultCountMetric`, which makes the caller's intent
 * invisible. The command vocabulary path puts the metric explicitly in the
 * caller, matching the spec's traceability rule.
 */
export async function createDataTable(args: {
  id: UUID;
  dataSourceId: UUID;
  name: string;
  table: string;
  sourceSchema?: SourceSchema;
  fields?: Field[];
  metrics?: Metric[];
  dataFrameId?: UUID;
}): Promise<UUID> {
  const { id } = await getWyStackClient().mutate(api.createDataTable, args);
  return id as UUID;
}

export async function updateDataTable(
  id: UUID,
  updates: Partial<Omit<DataTable, "id" | "createdAt" | "dataSourceId">>,
): Promise<void> {
  await getWyStackClient().mutate(api.updateDataTable, { id, updates });
}

export async function getDataTable(id: UUID): Promise<DataTable | undefined> {
  const result = await getWyStackClient().query(api.getDataTable, { id });
  return (result as DataTable | null) ?? undefined;
}
