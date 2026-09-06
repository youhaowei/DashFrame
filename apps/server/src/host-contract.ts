import type { hostOperations } from "./host/registry";

/** HTTP operations whose execution requires the native DashFrame host. */
export type HostOperationName =
  | "commitBatch"
  | "ingestLocalDataFrame"
  | "queryDataFrame"
  | "removeDataFrameEntry"
  | "clearAllData"
  | "getOrCreateDataSource"
  | "fetchData"
  | "runInsight"
  | "getConnectorCatalog"
  | "prepareRemoteDataTable"
  | "listNotionDatabases"
  | "listPostgresTables"
  | "listGa4Properties"
  | "getConnectorSetupSession"
  | "startConnectorSetup"
  | "cancelConnectorSetup"
  | "listAssistantProviderCatalog"
  | "listAssistantProviderConfigs"
  | "saveAssistantProviderConfig"
  | "removeAssistantProviderConfig"
  | "startAssistantOAuthLogin"
  | "setAssistantDefaultModel"
  | "getAccessConnectionInfo"
  | "getAccessCapabilities"
  | "listAccessCredentials"
  | "issueAccessCredential"
  | "revokeAccessCredential";

type Handler<K extends HostOperationName> = (typeof hostOperations)[K]["run"];
export type HostOperationArgs<K extends HostOperationName> = Parameters<
  Handler<K>
>[1];
export type HostOperationResult<K extends HostOperationName> = Awaited<
  ReturnType<Handler<K>>
>;
