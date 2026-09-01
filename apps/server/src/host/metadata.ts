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
  listPendingHostBatches(
    input: Omit<
      FunctionArgs<typeof internal.host.listPendingHostBatches>,
      "workspaceId"
    >,
  ): Promise<FunctionReturnType<typeof internal.host.listPendingHostBatches>>;
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
