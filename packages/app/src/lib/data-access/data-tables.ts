import {
  cmd,
  type DataTable,
  type Field,
  type Metric,
  type SourceSchema,
  type UUID,
} from "@dashframe/types";

import { api } from "../../wystack/api";
import { getWyStackClient } from "../../wystack/client";

/** Build the explicit default Count metric for a newly minted DataTable. */
export function makeDefaultCountMetric(tableId: UUID): Metric {
  return {
    id: crypto.randomUUID() as UUID,
    name: "Count",
    tableId,
    columnName: undefined,
    aggregation: "count",
  };
}

/**
 * Create a DataTable via the `CreateDataTable` command vocabulary — the
 * PRIMITIVE that does NOT auto-inject metrics. Callers are responsible for
 * passing explicit metrics (e.g. the default Count metric for file ingests).
 *
 * The command path stores exactly the supplied metrics, keeping default metric
 * policy explicit at each ingestion caller.
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
  await getWyStackClient().mutate(api.commitBatch, {
    commands: [cmd("CreateDataTable", args)],
  });
  return args.id;
}

export async function getDataTable(id: UUID): Promise<DataTable | undefined> {
  const result = await getWyStackClient().query(api.getDataTable, { id });
  return (result as DataTable | null) ?? undefined;
}
