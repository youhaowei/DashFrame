import type {
  CreateDataSourceInput,
  DataSource,
  DataSourceMutations,
  UseDataSourcesResult,
  UUID,
} from "@dashframe/types";
import { useMutation, useQuery } from "@wystack/client";
import { useMemo } from "react";

import { api } from "./api";
import { getWyStackClient } from "./client";
import { loose } from "./wystack-args";

export function useDataSources(): UseDataSourcesResult {
  const result = useQuery(api.listDataSources);
  return {
    data: result.data as DataSource[] | undefined,
    isLoading: result.isLoading,
  };
}

export function useDataSourceMutations(): DataSourceMutations {
  const addMutation = useMutation(api.addDataSource);
  const updateMutation = useMutation(api.updateDataSource);
  const removeMutation = useMutation(api.removeDataSource);

  return useMemo(
    () => ({
      add: async (input: CreateDataSourceInput): Promise<UUID> => {
        const { id } = await addMutation.mutateAsync(loose(input));
        return id;
      },
      update: async (
        id: UUID,
        updates: Partial<
          Pick<DataSource, "name" | "apiKey" | "connectionString">
        >,
      ): Promise<void> => {
        await updateMutation.mutateAsync(loose({ id, ...updates }));
      },
      remove: async (id: UUID): Promise<void> => {
        await removeMutation.mutateAsync({ id });
      },
    }),
    [addMutation, removeMutation, updateMutation],
  );
}

export async function addDataSource(
  input: CreateDataSourceInput,
): Promise<UUID> {
  const { id } = await getWyStackClient().mutate(
    api.addDataSource,
    loose(input),
  );
  return id;
}

export async function updateDataSource(
  id: UUID,
  updates: Partial<Pick<DataSource, "name" | "apiKey" | "connectionString">>,
): Promise<void> {
  await getWyStackClient().mutate(
    api.updateDataSource,
    loose({ id, ...updates }),
  );
}

export async function removeDataSource(id: UUID): Promise<void> {
  await getWyStackClient().mutate(api.removeDataSource, { id });
}

export async function getDataSource(id: UUID): Promise<DataSource | undefined> {
  const result = await getWyStackClient().query(api.getDataSource, { id });
  return (result as DataSource | null) ?? undefined;
}

export async function getDataSourceByType(
  type: string,
): Promise<DataSource | null> {
  const result = await getWyStackClient().query(api.getDataSourceByType, {
    type,
  });
  return result as DataSource | null;
}

/**
 * Deterministic UUID for the singleton DataSource of a connector `type`.
 *
 * The defect (PR #46 Greptile P1): two concurrent CSV ingests both ran the racy
 * `kind`-keyed check-then-insert and both inserted (no unique constraint on
 * `kind`). The fix (YW-106) is to key get-or-create on the PRIMARY KEY: a stable
 * id derived from the type means concurrent ingests target the same row, so the
 * `GetOrCreateDataSource` command is idempotent (the loser reads the winner's
 * row or conflicts on the PK and its batch rolls back — never two rows).
 *
 * Custom SHA-1 deterministic UUID: SHA-1 over the UTF-8 string
 * `namespace + type`, with v5 version and RFC 4122 variant bits set. NOT
 * RFC 4122 §4.3-conformant (that hashes a 16-byte UUID namespace, not a
 * string), so a standard UUIDv5 library will NOT reproduce these ids — this
 * derivation is the only minter, and the id space is stable once shipped (do
 * not change the rule without a migration). Stable across runs and processes
 * for a given type, which is exactly the idempotency key we need. (A per-`type`
 * singleton matches today's connector model — local, notion.
 * Multi-source-per-type uses `CreateDataSource` with a fresh random id instead.)
 */
const DATA_SOURCE_NAMESPACE = "dashframe:data-source:";

async function deterministicDataSourceId(type: string): Promise<UUID> {
  const bytes = new TextEncoder().encode(DATA_SOURCE_NAMESPACE + type);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", bytes));
  // Format the first 16 bytes as a v5 UUID (set version + variant bits).
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = Array.from(digest.subarray(0, 16), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}` as UUID;
}

export async function getOrCreateDataSourceByType(
  type: string,
  name: string,
): Promise<DataSource> {
  const id = await deterministicDataSourceId(type);
  // Single-command `.mutate()` is the degenerate one-command batch: it runs
  // WITHOUT the applyCommands transaction, so atomicity here rests on the PK
  // backstop (same deterministic id), not on the batch envelope.
  await getWyStackClient().mutate(api.getOrCreateDataSource, {
    id,
    type,
    name,
  });
  // The command returns only `{ id }`; read back the full row so callers keep
  // the DataSource contract they had with the old coarse mutation.
  const source = await getDataSource(id);
  if (!source) throw new Error(`Data source ${id} missing after get-or-create`);
  return source;
}

export async function getAllDataSources(): Promise<DataSource[]> {
  const result = await getWyStackClient().query(api.listDataSources, {});
  return result as DataSource[];
}
