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
  makeSecretRef,
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CREDENTIAL_COMMAND_ARG_FIELDS } from "@dashframe/assistant";
import { buildDashframeApp } from "./app";
import {
  captureCommandCredentials,
  CREDENTIAL_CONFIG_FIELDS,
} from "./credential-release";
import {
  createDraftController,
  type DraftController,
} from "./draft-controller";

import {
  cmd,
  COMMAND_PATHS,
  commandFunctions,
  CREDENTIAL_COMMAND_FIELDS,
} from "./functions/commands";

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

async function makeHarness(opts?: { onWrite?: () => void }): Promise<Harness> {
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
  if (opts?.onWrite) serverContext.onWrite = opts.onWrite;

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

  // SECURITY (YW-346) — the capture seam must REFUSE a caller-supplied ref on a
  // fresh draft append, never adopt it. This is the durable guarantee for agent
  // DataSource authoring: even driving appendToDraft directly (the runtime-
  // reachable seam, not just the applyCommand tool) a foreign `secret:<uuid>` is
  // rejected, so an untrusted caller cannot point a source at a secret it does
  // not own (bypassing storeCredential + the fail-closed guard).
  it("REFUSES a caller-supplied foreign ref on a draft append (CreateDataSource)", async () => {
    const foreign = makeSecretRef(); // valid shape, NOT stored in this vault
    const id = crypto.randomUUID();
    const draftId = await h.controller.openDraft();

    await expect(
      h.controller.appendToDraft(draftId, [
        cmd("CreateDataSource", {
          id,
          type: "notion",
          name: "Foreign",
          apiKey: foreign,
        }),
      ]),
    ).rejects.toThrow(/must be the plaintext secret, not a vault ref/i);

    // Nothing adopted, nothing logged — the rejected append left no draft state.
    const rows = await h.db
      .select()
      .from(draftCommandLog)
      .where(eq(draftCommandLog.draftId, draftId));
    expect(rows.length).toBe(0);
  });

  it("REFUSES a caller-supplied foreign ref on a draft append (SetDataSourceConfig)", async () => {
    const { id } = await seedCanonicalSource(h, "orig-key");
    const foreign = makeSecretRef();
    const draftId = await h.controller.openDraft();

    await expect(
      h.controller.appendToDraft(draftId, [
        cmd("SetDataSourceConfig", { id, connectionString: foreign }),
      ]),
    ).rejects.toThrow(/must be the plaintext secret, not a vault ref/i);
  });

  it("stores a plaintext credential as a ref on a draft append (agent happy path)", async () => {
    // The sanctioned input: plaintext is stored via storeCredential and the log
    // carries the minted ref (the same path the assistant exercises post-flip).
    const id = crypto.randomUUID();
    const draftId = await h.controller.openDraft();
    await h.controller.appendToDraft(draftId, [
      cmd("CreateDataSource", {
        id,
        type: "rest",
        name: "Agent source",
        apiKey: "pk-live-plaintext",
      }),
    ]);

    const args = await firstLogArgs(h, draftId);
    expect(args.apiKey).not.toBe("pk-live-plaintext");
    expect(isSecretRef(args.apiKey)).toBe(true);
    const resolved = await h.vault.withSecret(
      args.apiKey as SecretRef,
      async (pt) => pt,
    );
    expect(resolved).toBe("pk-live-plaintext");
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
    // (This asserts the OUTCOME; the post-commit ORDERING is enforced structurally
    // in the publishDraft RPC, which releases only after `await publishDraft`
    // resolves — a rejected publish skips release entirely.)
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

  // Snapshot-persistence gate — if onWrite (snapshot) throws, the replaced ref is
  // NOT released, so a stale-snapshot restore can't dangle a still-referenced ref.
  it("does not release the replaced ref when snapshot persistence fails", async () => {
    const failing = await makeHarness({
      onWrite: () => {
        throw new Error("snapshot persistence failed");
      },
    });
    try {
      const { id, ref: oldRef } = await seedCanonicalSource(
        failing,
        "orig-key",
      );
      const draftId = await failing.controller.openDraft();
      await failing.controller.appendToDraft(draftId, [
        cmd("SetDataSourceConfig", { id, apiKey: "rotated-key" }),
      ]);
      // Publish commits, but onWrite throws → snapshot not persisted → release is
      // skipped, leaving the old ref live (inert orphan) rather than dangling.
      await failing.app.call("publishDraft", { draftId });
      expect(await failing.vault.has(oldRef)).toBe(true);
    } finally {
      await failing.db.$client.close();
      rmSync(failing.dir, { recursive: true, force: true });
    }
  });

  // P1 — publish releases an intra-draft superseded ref (two writes to one field).
  it("releases an intermediate ref superseded within the draft on publish", async () => {
    const { id, ref: refA } = await seedCanonicalSource(h, "key-a");

    const draftId = await h.controller.openDraft();
    // Two credential writes to the SAME field, no compactionKey → both replayed.
    await h.controller.appendToDraft(draftId, [
      cmd("SetDataSourceConfig", { id, apiKey: "key-b" }),
    ]);
    await h.controller.appendToDraft(draftId, [
      cmd("SetDataSourceConfig", { id, apiKey: "key-c" }),
    ]);
    const logRows = await h.db
      .select({ args: draftCommandLog.args })
      .from(draftCommandLog)
      .where(eq(draftCommandLog.draftId, draftId))
      .orderBy(draftCommandLog.seq);
    const refB = (logRows[0]!.args as Record<string, unknown>)
      .apiKey as SecretRef;
    const refC = (logRows[1]!.args as Record<string, unknown>)
      .apiKey as SecretRef;
    expect(refB).not.toBe(refC);

    await h.app.call("publishDraft", { draftId });

    // Old canonical (A) AND the superseded intra-draft ref (B) are released; only
    // the final ref (C) survives and is what canonical points at.
    expect(await h.vault.has(refA)).toBe(false);
    expect(await h.vault.has(refB)).toBe(false);
    expect(await h.vault.has(refC)).toBe(true);
    expect((await readConfig(h, id))!.apiKey).toBe(refC);
  });

  // P2 — discard releases a ref a draft only INHERITED (held in shadow, not log).
  it("releases an inherited shadow ref when the pinning draft is discarded", async () => {
    const { id, ref: refR } = await seedCanonicalSource(h, "shared-key");

    // Draft A touches only connectionString → its shadow inherits apiKey ref R.
    const draftA = await h.controller.openDraft();
    await h.controller.appendToDraft(draftA, [
      cmd("SetDataSourceConfig", { id, connectionString: "conn-a" }),
    ]);

    // Draft B rotates apiKey and publishes — R is preserved because A pins it.
    const draftB = await h.controller.openDraft();
    await h.controller.appendToDraft(draftB, [
      cmd("SetDataSourceConfig", { id, apiKey: "rotated" }),
    ]);
    await h.app.call("publishDraft", { draftId: draftB });
    const refR2 = (await readConfig(h, id))!.apiKey as SecretRef;
    expect(await h.vault.has(refR)).toBe(true); // pinned by A, survived B's publish

    // Discard A — R is now referenced nowhere (canonical moved to R2), so the
    // shadow-sourced candidate set releases it; the live canonical ref stays.
    await h.app.call("discardDraft", { draftId: draftA });
    expect(await h.vault.has(refR)).toBe(false);
    expect(await h.vault.has(refR2)).toBe(true);
  });

  // P2 — a direct canonical call must STORE a ref-shaped input, never adopt it.
  it("stores (not adopts) a ref-shaped credential on a direct canonical call", async () => {
    const id = crypto.randomUUID();
    const refShaped = makeSecretRef(); // valid shape, NOT in the vault
    const { result } = await h.app.call("createDataSource", {
      id,
      type: "notion",
      name: "Direct",
      apiKey: refShaped,
    });
    expect((result as { id: string }).id).toBe(id);

    const stored = (await readConfig(h, id))!.apiKey as SecretRef;
    // The input was stored as plaintext → a DIFFERENT, real ref that resolves to it.
    expect(stored).not.toBe(refShaped);
    expect(isSecretRef(stored)).toBe(true);
    expect(await h.vault.has(stored)).toBe(true);
    const resolved = await h.vault.withSecret(stored, async (pt) => pt);
    expect(resolved).toBe(refShaped);
  });

  // Exhaustiveness — the capture map must cover EVERY credential-bearing command.
  // This is load-bearing for "plaintext never at rest": capture rewrites only
  // commands in CREDENTIAL_COMMAND_FIELDS, so a credential-bearing command missing
  // from it would log plaintext. Derive the truth from the command arg schemas so
  // the linkage cannot silently drift when the vocabulary grows.
  it("CREDENTIAL_COMMAND_FIELDS covers every credential-bearing command", () => {
    const CRED = ["apiKey", "connectionString"] as const;
    for (const [path, def] of Object.entries(commandFunctions)) {
      const argKeys = Object.keys(
        (def as { args: Record<string, unknown> }).args,
      );
      const credFields = CRED.filter((f) => argKeys.includes(f));
      if (credFields.length === 0) {
        expect(CREDENTIAL_COMMAND_FIELDS[path]).toBeUndefined();
      } else {
        expect(CREDENTIAL_COMMAND_FIELDS[path]).toBeDefined();
        expect([...(CREDENTIAL_COMMAND_FIELDS[path] ?? [])].sort()).toEqual(
          [...credFields].sort(),
        );
      }
    }
  });

  // Drift guard — the assistant's agent-path credential-ref gate
  // (CREDENTIAL_COMMAND_ARG_FIELDS, keyed by command NAME) must stay in lockstep
  // with the server's capture/release source of truth (CREDENTIAL_COMMAND_FIELDS,
  // keyed by command PATH). If a new credential field is added server-side but
  // not to the agent gate, the agent could supply a foreign ref in that field and
  // bypass the guard — so this fails the build instead of leaking the hole.
  it("agent credential-ref gate matches the server credential-field map", () => {
    // 1. Every command the agent gate guards maps to a server credential command
    //    with the SAME field set (via COMMAND_PATHS name→path).
    for (const [name, fields] of Object.entries(
      CREDENTIAL_COMMAND_ARG_FIELDS,
    )) {
      const path = COMMAND_PATHS[name as keyof typeof COMMAND_PATHS];
      expect(path, `no COMMAND_PATHS entry for "${name}"`).toBeDefined();
      expect([...(CREDENTIAL_COMMAND_FIELDS[path] ?? [])].sort()).toEqual(
        [...fields].sort(),
      );
    }
    // 2. Conversely, every server credential command is covered by the agent
    //    gate — a new credential command must update the gate or fail here.
    const guardedPaths = new Set(
      Object.keys(CREDENTIAL_COMMAND_ARG_FIELDS).map(
        (name) => COMMAND_PATHS[name as keyof typeof COMMAND_PATHS],
      ),
    );
    for (const path of Object.keys(CREDENTIAL_COMMAND_FIELDS)) {
      expect(
        guardedPaths.has(path as never),
        `server credential command "${path}" is not covered by the agent credential-ref gate`,
      ).toBe(true);
    }
  });

  // Fail-closed — a credential command carrying a compactionKey is rejected before
  // any ref is minted. compactLog would drop a superseded write whose capture had
  // already minted a ref, orphaning it (no log row → no transition release). The
  // reject closes that window; assert no vault store happened (nothing to orphan).
  it("rejects a credential command that carries a compactionKey, minting nothing", async () => {
    const storeSpy = vi.spyOn(h.vault, "store");
    const credCommand = cmd("CreateDataSource", {
      id: crypto.randomUUID(),
      type: "notion",
      name: "Keyed",
      apiKey: "plaintext",
    });
    await expect(
      captureCommandCredentials(
        { ...credCommand, compactionKey: "dup-key" },
        h.vault,
      ),
    ).rejects.toThrow(/compactionKey/);
    expect(storeSpy).not.toHaveBeenCalled(); // failed closed before minting
  });

  // Drift bridge — the config-side credential field list (CREDENTIAL_CONFIG_FIELDS,
  // iterated by refsFromConfig / collectSupersededRefs / the simulate seed) must
  // match the command-side truth (CREDENTIAL_COMMAND_FIELDS). A new credential field
  // added to commands but not to the config-reader list would make
  // collectReferencedRefs silently stop protecting it → a live secret released while
  // another draft still references it. Bridge the two so that drift fails the build.
  it("CREDENTIAL_CONFIG_FIELDS matches the command-side credential fields", () => {
    const commandSide = new Set(
      Object.values(CREDENTIAL_COMMAND_FIELDS).flat(),
    );
    const configSide = new Set<string>(CREDENTIAL_CONFIG_FIELDS);
    expect(configSide).toEqual(commandSide);
  });

  // Orphan-on-append-failure — capture's rollback releases the minted ref.
  it("capture rollback releases the ref it minted", async () => {
    const { command, rollback } = await captureCommandCredentials(
      cmd("CreateDataSource", {
        id: crypto.randomUUID(),
        type: "notion",
        name: "x",
        apiKey: "plaintext",
      }),
      h.vault,
    );
    const ref = (command.args as Record<string, unknown>).apiKey as SecretRef;
    expect(isSecretRef(ref)).toBe(true);
    expect(await h.vault.has(ref)).toBe(true);
    await rollback();
    expect(await h.vault.has(ref)).toBe(false);
  });

  it("releases captured refs when a draft command fails before it is logged", async () => {
    const delSpy = vi.spyOn(h.vault, "delete");
    const draftId = await h.controller.openDraft();
    // SetDataSourceConfig on a missing id throws in the handler AFTER capture mints
    // the ref — the failed append must release it, not orphan it.
    await expect(
      h.controller.appendToDraft(draftId, [
        cmd("SetDataSourceConfig", {
          id: crypto.randomUUID(),
          apiKey: "will-fail",
        }),
      ]),
    ).rejects.toThrow();

    expect(delSpy).toHaveBeenCalled(); // rollback released the minted ref
    const rows = await h.db
      .select()
      .from(draftCommandLog)
      .where(eq(draftCommandLog.draftId, draftId));
    expect(rows.length).toBe(0); // nothing logged
  });

  // P2 (fix #3) — the rollback must also cover LOG PERSISTENCE, not just the
  // handler run. If writeLog throws AFTER capture minted a ref and the handler
  // wrote the shadow, the ref is in the vault but in no durable log — discard /
  // publish could never find it for transition release (orphan). The rollback
  // stays armed through writeLog, so a log-persistence failure releases the ref.
  it("releases captured refs when log persistence fails after the handler runs", async () => {
    const id = crypto.randomUUID();
    const storeSpy = vi.spyOn(h.vault, "store");
    const delSpy = vi.spyOn(h.vault, "delete");
    // writeLog is the only `db.transaction` call in appendToDraft — runHandler
    // opens no transaction and readLog uses select — so failing the first
    // `transaction` fails writeLog specifically, AFTER the handler committed the
    // shadow row. (The shadow-row assertion below is the discriminator: if this
    // mock ever fired during the handler instead, no shadow row would exist and
    // this test would fail loudly rather than silently testing the wrong path.)
    const txSpy = vi
      .spyOn(h.db, "transaction")
      .mockRejectedValueOnce(new Error("simulated writeLog failure"));

    const draftId = await h.controller.openDraft();
    await expect(
      h.controller.appendToDraft(draftId, [
        cmd("CreateDataSource", {
          id,
          type: "notion",
          name: "X",
          apiKey: "secret-plaintext",
        }),
      ]),
    ).rejects.toThrow(/simulated writeLog failure/);

    // Capture minted a ref before writeLog failed, and the rollback released it.
    expect(storeSpy).toHaveBeenCalled();
    const mintedRef = (await storeSpy.mock.results[0]!.value) as SecretRef;
    expect(isSecretRef(mintedRef)).toBe(true);
    expect(delSpy).toHaveBeenCalled();
    expect(await h.vault.has(mintedRef)).toBe(false); // no orphan

    // DISCRIMINATOR: the shadow row exists → the handler committed before the
    // failure → the failure was at writeLog (not the handler). Proves this test
    // exercises the log-persistence path, not the already-covered handler path.
    const shadowRows = await h.db
      .select()
      .from(schema.dataSourcesDraft)
      .where(eq(schema.dataSourcesDraft.draftId, draftId));
    expect(shadowRows.length).toBe(1);

    // The durable log is empty — writeLog never committed.
    const logRows = await h.db
      .select()
      .from(draftCommandLog)
      .where(eq(draftCommandLog.draftId, draftId));
    expect(logRows.length).toBe(0);

    txSpy.mockRestore();
  });

  // P2 (fix #2) — fail-closed on the DIRECT path: a ref-shaped input on a direct
  // canonical call with NO vault injected must THROW (route through
  // storeCredential's guard), never silently adopt the ref. This is the security
  // half of the adoption gate: with the bug, the ref pass-through would accept a
  // ref-shaped value even absent a vault, persisting config that points at an
  // unverified/nonexistent secret. Pairs with the "stores (not adopts)" test.
  it("rejects a ref-shaped credential on a direct call when no vault is injected", async () => {
    const noVaultApp = await buildDashframeApp({ db: h.db }); // no vault injected
    await expect(
      noVaultApp.call("createDataSource", {
        id: crypto.randomUUID(),
        type: "notion",
        name: "NoVault",
        apiKey: makeSecretRef(), // valid ref shape, must NOT be adopted
      }),
    ).rejects.toThrow();
  });
});
