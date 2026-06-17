/**
 * Happy-path tests for the Notion data-plane routes.
 *
 * Proves the route-level contract that the fail-closed tests don't reach:
 *   - listNotionDatabases maps the connector's RemoteDatabase {id,name} to the
 *     renderer DTO {id,title} (the consumer renders/adds by `title`).
 *   - queryNotionDatabase returns the serializable result {arrowBuffer,
 *     fieldIds, fields} unchanged — no live DataFrame crosses the boundary.
 *   - Both resolve the credential through the bound resolver (vault.withSecret)
 *     server-side, with no plaintext returned to the caller.
 *
 * The Notion connector is mocked so no network call is made: the mock connector
 * invokes its bound resolver (proving the auth-blind path runs) and returns
 * fixed data. TestBackend is used ONLY in test setup — never in production code.
 */
import { openArtifactDb } from "@dashframe/server-core";
import {
  InMemoryMappingStore,
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
import { createWyStack, type WyStackApp } from "@wystack/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the connector so the routes resolve the credential via the bound
// resolver but never hit the Notion network. The mock connect()/query() call
// `auth` once (proving the route wires the resolver through) and return fixed
// data shaped exactly like the real connector.
vi.mock("@dashframe/connector-notion", () => ({
  makeNotionConnector: (
    auth: <T>(use: (plaintext: string) => Promise<T>) => Promise<T>,
  ) => ({
    id: "notion",
    sourceType: "remote-api" as const,
    connect: async () => auth(async () => [{ id: "db-1", name: "Roadmap" }]),
    query: async () =>
      auth(async () => ({
        arrowBuffer: "QVJST1cx", // base64 placeholder
        fieldIds: ["f1", "f2"],
        fields: [{ id: "f1" }, { id: "f2" }],
      })),
  }),
}));

import { functions } from "../functions";

function makeTestVault(): { vault: SecretVault; backend: TestBackend } {
  const backend = new TestBackend();
  const registry = new SecretRegistry();
  registry.register("test", backend, { fallback: true });
  registry.setClassDefault("connector-key", "test");
  const vault = new SecretVault(registry, new InMemoryMappingStore());
  return { vault, backend };
}

describe("Notion data-plane routes — happy path (mocked connector)", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: WyStackApp;
  let vault: SecretVault;
  let backend: TestBackend;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-notion-routes-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    ({ vault, backend } = makeTestVault());
    const rawApp = await createWyStack({ db, functions });
    app = {
      ...rawApp,
      async call(path, args, ctx) {
        return rawApp.call(path, args, { ...(ctx ?? {}), vault });
      },
      async runHandler(path, args, tracked, ctx) {
        return rawApp.runHandler(path, args, tracked, {
          ...(ctx ?? {}),
          vault,
        });
      },
    };
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Create a notion source with a stored credential ref, return its id. */
  async function seedNotionSource(): Promise<string> {
    const { result } = await app.call("addDataSource", {
      type: "notion",
      name: "My Notion",
      apiKey: "secret_plaintext",
    });
    return (result as { id: string }).id;
  }

  it("listNotionDatabases maps {id,name} → {id,title} and resolves via the vault", async () => {
    const id = await seedNotionSource();
    expect(backend.resolveCallCount).toBe(0);

    const { result } = await app.call("listNotionDatabases", {
      dataSourceId: id,
    });

    // DTO the renderer consumes: title, not name.
    expect(result).toEqual([{ id: "db-1", title: "Roadmap" }]);
    // The credential was materialized exactly once, server-side.
    expect(backend.resolveCallCount).toBe(1);
  });

  it("queryNotionDatabase returns the serializable result and resolves via the vault", async () => {
    const id = await seedNotionSource();
    expect(backend.resolveCallCount).toBe(0);

    const { result } = await app.call("queryNotionDatabase", {
      dataSourceId: id,
      databaseId: "db-1",
      tableId: crypto.randomUUID(),
    });

    // Serializable shape — raw Arrow buffer + ids + fields, no live DataFrame.
    const r = result as {
      arrowBuffer: string;
      fieldIds: string[];
      fields: unknown[];
    };
    expect(typeof r.arrowBuffer).toBe("string");
    expect(r.fieldIds).toEqual(["f1", "f2"]);
    expect(r.fields).toHaveLength(2);
    expect(r).not.toHaveProperty("dataFrame");
    // Credential resolved once, server-side; no plaintext in the payload.
    expect(backend.resolveCallCount).toBe(1);
    expect(JSON.stringify(result)).not.toContain("secret_plaintext");
  });
});
