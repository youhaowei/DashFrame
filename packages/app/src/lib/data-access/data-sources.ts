import { requestHost } from "@/data/host";
import type { DataSource, UUID } from "@dashframe/types";

import { api } from "@dashframe/convex-backend/api";
import { getConvexClient } from "@/data/runtime";

export async function getDataSource(id: UUID): Promise<DataSource | undefined> {
  const result = await getConvexClient().query(api.app.getDataSource, { id });
  return (result as DataSource | null) ?? undefined;
}

/**
 * Deterministic UUID for the singleton DataSource of a connector `type`.
 *
 * The defect (PR #46 Greptile P1): two concurrent CSV ingests both ran the racy
 * `kind`-keyed check-then-insert and both inserted (no unique constraint on
 * `kind`). The fix is to key get-or-create on the PRIMARY KEY: a stable
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
  // The host commits against this deterministic ID, so concurrent imports share one source.
  await requestHost("getOrCreateDataSource", {
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
