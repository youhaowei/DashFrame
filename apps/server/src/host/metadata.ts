import type { internal } from "@dashframe/convex-backend/api";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type {
  PublicationMetadata,
  DataSourceRow,
  DataTableRow,
  DataFrameRow,
  InsightRow,
} from "@dashframe/convex-backend/model";
import type { Field, Command, Metric, TableOrigin } from "@dashframe/types";
import type { Principal } from "@wystack/identity";
import type { ConnectorSetupStore } from "../connector-setup/session-store";

export class ImportPublicationRejectedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ImportPublicationRejectedError";
  }
}

export function importPublicationRejection(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("data" in error))
    return null;
  let data = (error as { data: unknown }).data;
  for (let depth = 0; typeof data === "string" && depth < 4; depth++) {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (typeof data !== "object" || data === null) return null;
  const value = data as { code?: unknown; message?: unknown };
  return value.code === "IMPORT_PUBLICATION_REJECTED" &&
    typeof value.message === "string"
    ? value.message
    : null;
}

/** A cursor-paged read; follow `continueCursor` until `isDone`. */
export interface Page<T> {
  page: T[];
  isDone: boolean;
  continueCursor: string;
}

/** Every row of a cursor-paged read, collected one page at a time. */
export async function collectPages<T>(
  fetchPage: (cursor: string | null) => Promise<Page<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;
  for (;;) {
    const result = await fetchPage(cursor);
    rows.push(...result.page);
    if (result.isDone) return rows;
    if (result.continueCursor === cursor)
      throw new Error("A paged read did not advance its cursor");
    cursor = result.continueCursor;
  }
}

/**
 * Drive a batched write until it reports completion. The backend schedules
 * its own continuation after every full batch, so each call here only
 * shortens the wait; each call starts a fresh run, so the two never double
 * apply. The bound is far past any workspace size and only stops a backend
 * that never reports completion from pinning the host in a loop.
 */
export async function untilComplete(
  step: () => Promise<{ complete: boolean }>,
  maxCalls = 10_000,
): Promise<void> {
  for (let calls = 0; calls < maxCalls; calls++)
    if ((await step()).complete) return;
  throw new Error("Bulk operation did not report completion");
}

export interface LocalImportClaim {
  frameId: string;
  fetchedAt: number;
  status: "pending" | "complete";
  result: {
    dataFrameId: string;
    rowCount: number;
    columnCount: number;
    fetchedAt: number;
  } | null;
}

/** Domain operations offered to trusted host code; no SQL or arbitrary writes. */
export interface HostMetadata {
  connectorSetup: ConnectorSetupStore;
  prepareHostBatch(
    input: Omit<
      FunctionArgs<typeof internal.host.prepareHostBatch>,
      "workspaceId"
    >,
  ): Promise<FunctionReturnType<typeof internal.host.prepareHostBatch>>;
  executeHostBatch(
    input: Omit<
      FunctionArgs<typeof internal.host.executeHostBatch>,
      "workspaceId"
    >,
  ): Promise<FunctionReturnType<typeof internal.host.executeHostBatch>>;
  getHostBatch(
    input: Omit<FunctionArgs<typeof internal.host.getHostBatch>, "workspaceId">,
  ): Promise<FunctionReturnType<typeof internal.host.getHostBatch>>;
  settleHostBatch(
    input: Omit<
      FunctionArgs<typeof internal.host.settleHostBatch>,
      "workspaceId"
    >,
  ): Promise<FunctionReturnType<typeof internal.host.settleHostBatch>>;
  listCleanup(
    input: Omit<FunctionArgs<typeof internal.host.listCleanup>, "workspaceId">,
  ): Promise<FunctionReturnType<typeof internal.host.listCleanup>>;
  claimCleanup(
    input: Omit<FunctionArgs<typeof internal.host.claimCleanup>, "workspaceId">,
  ): Promise<FunctionReturnType<typeof internal.host.claimCleanup>>;
  ackCleanup(
    input: Omit<FunctionArgs<typeof internal.host.ackCleanup>, "workspaceId">,
  ): Promise<FunctionReturnType<typeof internal.host.ackCleanup>>;

  beginLocalImport(input: {
    operationId: string;
    requestHash: string;
    claimKind?: "local-ingest" | "connector-snapshot";
  }): Promise<LocalImportClaim>;
  getLocalImport(input: {
    operationId: string;
    requestHash: string;
  }): Promise<LocalImportClaim | null>;
  cancelLocalImport(input: {
    operationId: string;
    requestHash: string;
  }): Promise<boolean>;
  getOperation(
    operationId: string,
  ): Promise<{ request: unknown; result: unknown } | null>;
  commitBatch(
    principal: Principal,
    commands: Command[],
  ): Promise<{
    mode: "commit";
    commands: Command[];
    results: Array<{ id?: string; value: unknown }>;
    tablesWritten: string[];
  }>;
  draftBatch(
    principal: Principal,
    commands: Command[],
    draftId?: string,
  ): Promise<{
    draftId: string;
    results: Array<{ id?: string; value: unknown }>;
  }>;
  getDataSource(id: string): Promise<DataSourceRow | null>;
  getDataTable(id: string): Promise<DataTableRow | null>;
  /** One page of the remote resources a source's tables read, e.g. GA4 properties. */
  listDataTableResources(
    dataSourceId: string,
    cursor: string | null,
  ): Promise<Page<string>>;
  getDataFrame(id: string): Promise<DataFrameRow | null>;
  getInsight(id: string): Promise<InsightRow | null>;
  /** Every frame an insight holds, collected across pages. */
  listDataFramesByInsight(insightId: string): Promise<DataFrameRow[]>;
  /** Every frame in the workspace, collected across pages. */
  listDataFrames(): Promise<DataFrameRow[]>;
  removeDataFrame(id: string): Promise<void>;
  /**
   * Resolves once the workspace is empty. The backend clears in batches and
   * schedules the rest itself; this call waits on each batch until none is
   * left, so a caller may act on the cleared workspace when it returns.
   */
  clearAllData(): Promise<void>;
  commitImportedFrame(input: {
    operationId?: string;
    requestHash?: string;
    expectedDataSourceRevision?: number;
    dataTableId: string;
    dataSourceId: string;
    expectedDataFrameId: string | null;
    frameRow: Omit<
      DataFrameRow,
      "createdAt" | "updatedAt" | "workspaceId" | "revision"
    >;
    tableUpdate: Partial<Omit<DataTableRow, "origin">>;
  }): Promise<void>;
  revokeCredential(credentialId: string): Promise<void>;
  publishMaterialization(value: PublicationMetadata): Promise<void>;
  replaceDataSourceConfig(input: {
    id: string;
    expectedRevision: number;
    expectedConfig: unknown;
    config: unknown;
  }): Promise<void>;
  prepareRemoteDataTable(input: {
    id: string;
    dataSourceId: string;
    table: string;
    fields: Field[];
    /** Replaces the table's measures, only on the call that first sets fields. */
    metrics?: Metric[];
    origin?: TableOrigin;
  }): Promise<Field[]>;
}

/** Recovery records available only to the local administrative backend. */
export interface LocalRecoveryMetadata {
  listPendingHostBatches(
    input: Omit<
      FunctionArgs<typeof internal.host.listPendingHostBatches>,
      "workspaceId"
    >,
  ): Promise<FunctionReturnType<typeof internal.host.listPendingHostBatches>>;
}
