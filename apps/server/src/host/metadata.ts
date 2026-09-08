import type { internal } from "@dashframe/convex-backend/api";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type {
  PublicationMetadata,
  DataSourceRow,
  DataTableRow,
  DataFrameRow,
  InsightRow,
} from "@dashframe/convex-backend/model";
import type { Field } from "@dashframe/types";
import type { Principal } from "@wystack/identity";
import type { Command } from "@dashframe/types";
import type { ConnectorSetupStore } from "../connector-setup/session-store";

export interface AssistantProviderConfigRow {
  id: string;
  providerId: string;
  displayLabel: string;
  authKind: "api-key" | "local" | "oauth";
  baseUrl: string | null;
  credentialRef: string | null;
  defaultModel: string;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

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
  getDataFrame(id: string): Promise<DataFrameRow | null>;
  getInsight(id: string): Promise<InsightRow | null>;
  listDataFramesByInsight(insightId: string): Promise<DataFrameRow[]>;
  listDataFrames(): Promise<DataFrameRow[]>;
  removeDataFrame(id: string): Promise<void>;
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
    tableUpdate: Partial<DataTableRow>;
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
  }): Promise<Field[]>;
  listAssistantProviderConfigs(): Promise<AssistantProviderConfigRow[]>;
  getAssistantProviderConfig(
    id: string,
  ): Promise<AssistantProviderConfigRow | null>;
  saveAssistantProviderConfig(input: {
    row: AssistantProviderConfigRow;
    expected: AssistantProviderConfigRow | null;
  }): Promise<AssistantProviderConfigRow>;
  removeAssistantProviderConfig(input: {
    id: string;
    expected: AssistantProviderConfigRow;
  }): Promise<void>;
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
