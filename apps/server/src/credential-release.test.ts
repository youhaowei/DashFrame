/**
 * Agent credential write path — capture-before-log + transition-time release.
 *
 * Tests the security invariants that make agent-authorable credentials safe (the
 * acceptance criteria of the feature):
 *
 *   1. Plaintext NEVER at rest — a credentialed command logged into
 *      `draft_command_log` carries a vault ref, never the plaintext.
 *   2. Ref-carrying / no double-wrap — the logged ref resolves to the original
 *      plaintext (it was stored once, not re-wrapped).
 *   3. No synchronous release on the draft path — a rotate inside a draft leaves
 *      the prior canonical secret live; release is deferred to a transition.
 *   4. Publish releases the REPLACED canonical ref (and only it).
 *   5. Discard never deletes a live secret; it releases only draft-minted refs.
 *   6. Cross-draft safety — a ref another open draft references survives a release.
 *   7. Publish ROLLBACK never deletes a live secret — if replay rolls back, the
 *      replaced ref is NOT released (release is post-commit).
 *   8. Read-deny holds — the read DTO never surfaces a raw ref (regression).
 *   9. Provenance — an agent-context create stamps `createdBy: { kind: "agent" }`.
 *
 * Harness: a socket-less mirror of `createDashframeServer`'s context wiring — the
 * vault seam (`buildDashframeApp`) plus the `serverContext` injection
 * (draftController / artifactDb / onWrite) the draft RPC handlers read.
 */
import {
  draftCommandLog,
  openArtifactDb,
  schema,
} from "@dashframe/server-core";
import {
  InMemoryMappingStore,
  isSecretRef,
  SecretRegistry,
  SecretVault,
  TestBackend,
  type SecretRef,
} from "@wystack/secret-vault";
import type { WyStackApp } from "@wystack/server";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildDashframeApp } from "./app";
import { captureCommandCredentials } from "./credential-release";
import {
  createDraftController,
  type DraftController,
} from "./draft-controller";
import { cmd } from "./functions/commands";

const { dataSources } = schema;

function makeTestVault(): { vault: SecretVault; backend: TestBackend } {
  const backend = new TestBackend();
  const registry = new SecretRegistry();
  registry.register("test", backend, { fallback: true });
  registry.setClassDefault("connector-key", "test");
  const vault = new SecretVault(registry, new InMemoryMappingStore());
  return { vault, backend };
}

interface Harness {
  dir: string;
  db: Awaited<ReturnType<typeof openArtifactDb>>;
  vault: SecretVault;
  app: WyStackApp;
  controller: DraftController;
}

async function makeHarness(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "dashframe-cred-release-"));
  const db = await openArtifactDb({ path: join(dir, "artifacts.db") });
  const { vault } = makeTestVault();

  const baseApp = await buildDashframeApp({ db, vault });

  // Mirror createDashframeServer's serverContext seam (without a socket): the
  // draft RPC handlers read draftController / artifactDb from the call context.
  const serverContext: Record<string, unknown> = {};
  const app: WyStackApp = {
    ...baseApp,
    async call(path, args, ctx) {
      return baseApp.call(path, args, { ...(ctx ?? {}), ...serverContext });
    },
    async runHandler(path, args, tracked, ctx) {
      return baseApp.runHandler(path, args, tracked, {
        ...(ctx ?? {}),
        ...serverContext,
      });
    },
  };

  const controller = createDraftController(app, db, {
    captureCredentials: (c) => captureCommandCredentials(c, vault),
  });
  serverContext.draftController = controller;
  serverContext.artifactDb = db;

  return { dir, db, vault, app, controller };
}

/** Read the raw stored config jsonb for a canonical data-source row. */
async function readConfig(
  h: Harness,
  id: string,
): Promise<Record<string, unknown> | null> {
  const rows = await h.db
    .select()
    .from(dataSources)
    .where(eq(dataSources.id, id));
  return rows[0] ? (rows[0].config as Record<string, unknown>) : null;
}

/** Read the first persisted draft-command-log args for a draft (asserts present). */
async function firstLogArgs(
  h: Harness,
  draftId: string,
): Promise<Record<string, unknown>> {
  const rows = await h.db
    .select({ args: draftCommandLog.args })
    .from(draftCommandLog)
    .where(eq(draftCommandLog.draftId, draftId));
  const args = rows[0]?.args;
  if (args == null || typeof args !== "object") {
    throw new Error(`no log args for draft ${draftId}`);
  }
  return args as Record<string, unknown>;
}

/** Seed a canonical data source with a credential via the live (legacy) path. */
async function seedCanonicalSource(
  h: Harness,
  apiKey: string,
): Promise<{ id: string; ref: SecretRef }> {
  const { result } = await h.app.call("addDataSource", {
    type: "notion",
    name: "Seed",
    apiKey,
  });
  const id = (result as { id: string }).id;
  const config = await readConfig(h, id);
  return { id, ref: config!.apiKey as SecretRef };
}

describe("credential write path — capture-before-log + transition release", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await makeHarness();
  });
  afterEach(async () => {
    await h.db.$client.close();
    rmSync(h.dir, { recursive: true, force: true });
  });

  // 1 + 2 — plaintext never at rest; the logged ref resolves to the plaintext.
  it("logs a vault ref (never plaintext) for a credentialed draft command", async () => {
    const id = crypto.randomUUID();
    const draftId = await h.controller.openDraft();
    await h.controller.appendToDraft(draftId, [
      cmd("CreateDataSource", {
        id,
        type: "notion",
        name: "Drafted",
        apiKey: "super-secret-plaintext",
      }),
    ]);

    const args = await firstLogArgs(h, draftId);
    expect(args).toBeDefined();
    // Plaintext NEVER at rest in the log.
    expect(args.apiKey).not.toBe("super-secret-plaintext");
    expect(isSecretRef(args.apiKey)).toBe(true);

    // Ref-carrying / no double-wrap: the logged ref resolves to the plaintext.
    const ref = args.apiKey as SecretRef;
    const resolved = await h.vault.withSecret(ref, async (pt) => pt);
    expect(resolved).toBe("super-secret-plaintext");
  });

  // 3 — no synchronous release on the draft path.
  it("does not release the prior canonical ref during a draft rotate", async () => {
    const { id, ref: oldRef } = await seedCanonicalSource(h, "orig-key");

    const draftId = await h.controller.openDraft();
    await h.controller.appendToDraft(draftId, [
      cmd("SetDataSourceConfig", { id, apiKey: "rotated-key" }),
    ]);

    // The old canonical secret is STILL live — release is deferred to publish.
    expect(await h.vault.has(oldRef)).toBe(true);

    // The draft minted a fresh ref (captured), distinct from the old one.
    const args = await firstLogArgs(h, draftId);
    const newRef = args.apiKey as SecretRef;
    expect(isSecretRef(newRef)).toBe(true);
    expect(newRef).not.toBe(oldRef);
    expect(await h.vault.has(newRef)).toBe(true);
  });

  // 4 + 8 — publish releases the replaced canonical ref; read DTO hides the ref.
  it("releases the replaced canonical ref on publish and keeps the new one", async () => {
    const { id, ref: oldRef } = await seedCanonicalSource(h, "orig-key");

    const draftId = await h.controller.openDraft();
    await h.controller.appendToDraft(draftId, [
      cmd("SetDataSourceConfig", { id, apiKey: "rotated-key" }),
    ]);
    const args = await firstLogArgs(h, draftId);
    const newRef = args.apiKey as SecretRef;

    await h.app.call("publishDraft", { draftId });

    // Old ref released, new ref live, canonical points at the new ref.
    expect(await h.vault.has(oldRef)).toBe(false);
    expect(await h.vault.has(newRef)).toBe(true);
    const config = await readConfig(h, id);
    expect(config!.apiKey).toBe(newRef);

    // Read-deny: the DTO never surfaces a raw ref.
    const { result } = await h.app.call("getDataSource", { id });
    const dto = result as { config: Record<string, unknown> };
    expect(dto.config.apiKey).toBeUndefined();
    expect(dto.config.hasApiKey).toBe(true);
  });

  // 5 — discard never deletes a live secret; releases only draft-minted refs.
  it("releases draft-minted refs on discard but never the live canonical one", async () => {
    const { id, ref: oldRef } = await seedCanonicalSource(h, "orig-key");

    const draftId = await h.controller.openDraft();
    await h.controller.appendToDraft(draftId, [
      cmd("SetDataSourceConfig", { id, apiKey: "rotated-key" }),
    ]);
    const args = await firstLogArgs(h, draftId);
    const mintedRef = args.apiKey as SecretRef;

    await h.app.call("discardDraft", { draftId });

    // Draft-minted ref released; the live canonical secret survives untouched.
    expect(await h.vault.has(mintedRef)).toBe(false);
    expect(await h.vault.has(oldRef)).toBe(true);
    const config = await readConfig(h, id);
    expect(config!.apiKey).toBe(oldRef);
  });

  // 6 — cross-draft safety: a ref another open draft's shadow references survives.
  it("does not release a ref another open draft still references (publish)", async () => {
    const { id, ref: sharedRef } = await seedCanonicalSource(h, "shared-key");

    // Draft A touches ONLY connectionString — its shadow inherits the apiKey ref.
    const draftA = await h.controller.openDraft();
    await h.controller.appendToDraft(draftA, [
      cmd("SetDataSourceConfig", { id, connectionString: "conn-a" }),
    ]);

    // Draft B rotates apiKey and publishes — it would release the old shared ref,
    // but draft A's shadow still references it, so it must survive.
    const draftB = await h.controller.openDraft();
    await h.controller.appendToDraft(draftB, [
      cmd("SetDataSourceConfig", { id, apiKey: "rotated-by-b" }),
    ]);
    await h.app.call("publishDraft", { draftId: draftB });

    expect(await h.vault.has(sharedRef)).toBe(true);
  });

  // 7 — publish ROLLBACK never deletes a live secret (release is post-commit).
  it("does not release the replaced ref when publish rolls back", async () => {
    const id = crypto.randomUUID();

    // Publish a CreateDataSource for `id` → canonical row with a live ref.
    const draftA = await h.controller.openDraft();
    await h.controller.appendToDraft(draftA, [
      cmd("CreateDataSource", {
        id,
        type: "notion",
        name: "A",
        apiKey: "key-a",
      }),
    ]);
    await h.app.call("publishDraft", { draftId: draftA });
    const canonicalRef = (await readConfig(h, id))!.apiKey as SecretRef;
    expect(await h.vault.has(canonicalRef)).toBe(true);

    // A second draft re-creates the SAME id → replay hits a duplicate PK → the
    // publish transaction rolls back. The replaced-ref release must NOT run.
    const draftB = await h.controller.openDraft();
    await h.controller.appendToDraft(draftB, [
      cmd("CreateDataSource", {
        id,
        type: "notion",
        name: "B",
        apiKey: "key-b",
      }),
    ]);
    await expect(
      h.app.call("publishDraft", { draftId: draftB }),
    ).rejects.toThrow();

    // Canonical secret intact — a rolled-back publish never deletes a live secret.
    expect(await h.vault.has(canonicalRef)).toBe(true);
    expect((await readConfig(h, id))!.apiKey).toBe(canonicalRef);
  });

  // 9 — provenance: an agent-context create is auditably distinct.
  it("stamps agent provenance when the create runs in an agent context", async () => {
    const id = crypto.randomUUID();
    const draftId = await h.controller.openDraft();
    // The agent enablement EMITS createdBy in the command, so it survives the
    // publish log replay onto the canonical row.
    await h.controller.appendToDraft(draftId, [
      cmd("CreateDataSource", {
        id,
        type: "notion",
        name: "Agent Src",
        createdBy: { kind: "agent" },
      }),
    ]);
    await h.app.call("publishDraft", { draftId });

    const rows = await h.db
      .select({ createdBy: dataSources.createdBy })
      .from(dataSources)
      .where(eq(dataSources.id, id));
    expect(rows[0]?.createdBy).toEqual({ kind: "agent" });
  });
});
