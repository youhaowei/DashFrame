/**
 * DrizzleMappingStore — a project-DB-backed {@link MappingStore}.
 *
 * The SecretVault substrate ships only an in-memory MappingStore. That loses the
 * `ref → { backend, locator }` binding on every process restart, which is fatal:
 * the ref persists in `data_sources.config` on disk and the encrypted blob
 * persists in the keychain, but without the mapping the vault cannot find the
 * locator for a ref — so `has(ref)` returns false and `withSecret(ref, …)` throws
 * after the first restart. Every stored credential becomes permanently
 * unresolvable.
 *
 * This implementation persists the mapping in the SAME project artifact DB that
 * holds the ref (the `secret_mappings` table). Co-locating them in one DB means
 * they share a single transactional/backup/snapshot boundary — the ref in config
 * and its mapping row can never drift out of sync (a restore that brings back one
 * brings back the other).
 *
 * Plaintext-never-at-rest is unaffected: this table stores ONLY the opaque ref,
 * the backend NAME, and the backend's opaque locator — never the secret itself.
 */

import type {
  MappingRecord,
  MappingStore,
  SecretRef,
} from "@wystack/secret-vault";
import { eq } from "drizzle-orm";

import type { ArtifactDb } from "./db";
import { secretMappings } from "./schema";

/**
 * MappingStore implementation backed by the project artifact DB.
 *
 * Implements `@wystack/secret-vault`'s `MappingStore` interface
 * (`get` / `set` / `has` / `delete`, all async). Constructed in Electron main and
 * passed to `new SecretVault(registry, store)`.
 */
export class DrizzleMappingStore implements MappingStore {
  readonly #db: ArtifactDb;

  constructor(db: ArtifactDb) {
    this.#db = db;
  }

  async get(ref: SecretRef): Promise<MappingRecord | undefined> {
    const rows = await this.#db
      .select({
        backend: secretMappings.backend,
        locator: secretMappings.locator,
      })
      .from(secretMappings)
      .where(eq(secretMappings.ref, ref))
      .limit(1);
    const row = rows[0];
    return row ? { backend: row.backend, locator: row.locator } : undefined;
  }

  async set(ref: SecretRef, record: MappingRecord): Promise<void> {
    // Upsert on the ref primary key: a re-store of the same ref (rotation) or a
    // replay of migration after a partial failure overwrites the binding rather
    // than throwing on the unique key.
    await this.#db
      .insert(secretMappings)
      .values({
        ref,
        backend: record.backend,
        locator: record.locator,
      })
      .onConflictDoUpdate({
        target: secretMappings.ref,
        set: { backend: record.backend, locator: record.locator },
      });
  }

  async delete(ref: SecretRef): Promise<void> {
    await this.#db.delete(secretMappings).where(eq(secretMappings.ref, ref));
  }

  async has(ref: SecretRef): Promise<boolean> {
    const rows = await this.#db
      .select({ ref: secretMappings.ref })
      .from(secretMappings)
      .where(eq(secretMappings.ref, ref))
      .limit(1);
    return rows.length > 0;
  }
}
