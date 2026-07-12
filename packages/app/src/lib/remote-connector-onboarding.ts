import type { CreateDataSourceInput, UUID } from "@dashframe/types";

export type SupportedRemoteConnectorId = "notion" | "postgres";

export interface RemoteResource {
  id: string;
  title: string;
}

interface ConnectRemoteSourceOptions {
  connectorId: SupportedRemoteConnectorId;
  connectorName: string;
  credentials: Record<string, unknown>;
  addSource: (input: CreateDataSourceInput) => Promise<UUID>;
  removeSource: (id: UUID) => Promise<void>;
  listNotionDatabases: (id: UUID) => Promise<RemoteResource[]>;
  listPostgresTables: (id: UUID) => Promise<RemoteResource[]>;
}

/** Create, probe, and compensate a remote source as one onboarding operation. */
export async function connectRemoteSource({
  connectorId,
  connectorName,
  credentials,
  addSource,
  removeSource,
  listNotionDatabases,
  listPostgresTables,
}: ConnectRemoteSourceOptions): Promise<{
  connectorId: SupportedRemoteConnectorId;
  sourceId: UUID;
  resources: RemoteResource[];
}> {
  const apiKey =
    typeof credentials.apiKey === "string" ? credentials.apiKey : undefined;
  const connectionString =
    typeof credentials.connectionString === "string"
      ? credentials.connectionString
      : undefined;
  const defaultSchema =
    typeof credentials.defaultSchema === "string" &&
    credentials.defaultSchema.trim()
      ? credentials.defaultSchema.trim()
      : undefined;

  let sourceId: UUID | null = null;
  try {
    sourceId = await addSource({
      type: connectorId,
      name: connectorName,
      apiKey,
      connectionString,
      config: defaultSchema ? { defaultSchema } : undefined,
    });
    const resources =
      connectorId === "notion"
        ? await listNotionDatabases(sourceId)
        : await listPostgresTables(sourceId);
    return { connectorId, sourceId, resources };
  } catch (cause) {
    if (sourceId) await removeSource(sourceId).catch(() => {});
    throw cause;
  }
}
