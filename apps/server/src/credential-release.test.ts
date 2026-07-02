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

async function makeHarness(opts?: {
  onWrite?: () => void;
  flushSnapshot?: () => Promise<void>;
}): Promise<Harness> {
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
    captureCredentials: (c) => captureCommandCredentials(c, vault, db),
  });
  serverContext.draftController = controller;
  serverContext.artifactDb = db;
  if (opts?.onWrite) serverContext.onWrite = opts.onWrite;
  if (opts?.flushSnapshot) serverContext.flushSnapshot = opts.flushSnapshot;

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
    // Wire a no-op flushSnapshot so tests that publish/discard with credential
    // refs get the durable-flush gate satisfied and refs are released as expected.
    // Without this, the fail-closed path (no hook → skip release) would block
    // all release assertions in this describe block.
    h = await makeHarness({ flushSnapshot: async () => {} });
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

  // SECURITY — the capture seam must REFUSE a caller-supplied ref on a
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
    ).rejects.toThrow(/plaintext secret, not a vault ref/i);

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
    ).rejects.toThrow(/plaintext secret, not a vault ref/i);
  });

  // The hole the typed-field-only guard missed: a ref nested in `extra` (e.g. a
  // REST source's `extra.authRef`, which the REST connector resolves via the
  // vault). The reject is field-agnostic + recursive, so the nested ref is caught.
  it("REFUSES a caller-supplied foreign ref nested in extra.authRef (SetDataSourceConfig)", async () => {
    const { id } = await seedCanonicalSource(h, "orig-key");
    const foreign = makeSecretRef();
    const draftId = await h.controller.openDraft();

    await expect(
      h.controller.appendToDraft(draftId, [
        cmd("SetDataSourceConfig", {
          id,
          extra: { endpoint: "https://api.example.com", authRef: foreign },
        }),
      ]),
    ).rejects.toThrow(/plaintext secret, not a vault ref/i);

    const rows = await h.db
      .select()
      .from(draftCommandLog)
      .where(eq(draftCommandLog.draftId, draftId));
    expect(rows.length).toBe(0);
  });

  // No-orphan on a PARTIAL-BATCH reject: a first command mints a real ref, a
  // later command in the same batch carries a foreign ref and is rejected — the
  // whole append throws and the first command's minted ref is released (no
  // orphaned keychain blob from the abandoned batch).
  it("releases a prior command's minted ref when a later batch command is rejected", async () => {
    const storeSpy = vi.spyOn(h.vault, "store");
    try {
      const draftId = await h.controller.openDraft();
      const foreign = makeSecretRef();

      await expect(
        h.controller.appendToDraft(draftId, [
          cmd("CreateDataSource", {
            id: crypto.randomUUID(),
            type: "rest",
            name: "First",
            apiKey: "plaintext-first",
          }),
          cmd("SetDataSourceConfig", {
            id: crypto.randomUUID(),
            apiKey: foreign,
          }),
        ]),
      ).rejects.toThrow(/plaintext secret, not a vault ref/i);

      // The first command minted exactly one ref; it must have been released.
      expect(storeSpy).toHaveBeenCalledTimes(1);
      const mintedRef = (await storeSpy.mock.results[0]!.value) as SecretRef;
      expect(await h.vault.has(mintedRef)).toBe(false);

      // Nothing persisted — the rejected batch left no draft state.
      const rows = await h.db
        .select()
        .from(draftCommandLog)
        .where(eq(draftCommandLog.draftId, draftId));
      expect(rows.length).toBe(0);
    } finally {
      storeSpy.mockRestore();
    }
  });

  it("ALLOWS endpoint/extra config on a NON-credentialed source", async () => {
    // No inherited credential → nothing to exfil → the config change is allowed.
    const { result } = await h.app.call("addDataSource", {
      type: "rest",
      name: "NoCred",
    });
    const id = (result as { id: string }).id;
    const draftId = await h.controller.openDraft();

    await h.controller.appendToDraft(draftId, [
      cmd("SetDataSourceConfig", {
        id,
        extra: { endpoint: "https://api.example.com", method: "GET" },
      }),
    ]);

    const rows = await h.db
      .select()
      .from(draftCommandLog)
      .where(eq(draftCommandLog.draftId, draftId));
    expect(rows.length).toBe(1);
  });

  // SECURITY — endpoint-redirect exfil of an INHERITED credential. A
  // SetDataSourceConfig that changes config (e.g. a new endpoint) on an EXISTING
  // credentialed source WITHOUT re-affirming the credential would carry the user's
  // secret to the new target (the connector resolves config.<cred> and sends it to
  // config.endpoint; the SSRF guard is private-range-only, a public host passes).
  // Same threat class as the foreign-ref hole — the foreign-ENDPOINT variant.
  it("REFUSES reconfiguring a credentialed source without re-affirming the credential", async () => {
    const { id, ref } = await seedCanonicalSource(h, "user-secret");
    const draftId = await h.controller.openDraft();

    await expect(
      h.controller.appendToDraft(draftId, [
        cmd("SetDataSourceConfig", {
          id,
          extra: { endpoint: "https://attacker.example" },
        }),
      ]),
    ).rejects.toThrow(/inherited credential|silently redirected/i);

    // Nothing logged; the user's secret is untouched and still live.
    const rows = await h.db
      .select()
      .from(draftCommandLog)
      .where(eq(draftCommandLog.draftId, draftId));
    expect(rows.length).toBe(0);
    expect(await h.vault.has(ref)).toBe(true);
  });

  it("ALLOWS reconfiguring a credentialed source when the credential is RE-SUPPLIED", async () => {
    const { id } = await seedCanonicalSource(h, "user-secret");
    const draftId = await h.controller.openDraft();

    // Re-supplying apiKey (plaintext) in the same command re-affirms the credential.
    await h.controller.appendToDraft(draftId, [
      cmd("SetDataSourceConfig", {
        id,
        apiKey: "rotated",
        extra: { endpoint: "https://api.example.com" },
      }),
    ]);

    const rows = await h.db
      .select()
      .from(draftCommandLog)
      .where(eq(draftCommandLog.draftId, draftId));
    expect(rows.length).toBe(1);
  });

  it("ALLOWS reconfiguring a credentialed source when the credential is CLEARED", async () => {
    const { id } = await seedCanonicalSource(h, "user-secret");
    const draftId = await h.controller.openDraft();

    // Clearing apiKey ("") drops the inherited secret → nothing carried → allowed.
    await h.controller.appendToDraft(draftId, [
      cmd("SetDataSourceConfig", {
        id,
        apiKey: "",
        extra: { endpoint: "https://api.example.com" },
      }),
    ]);

    const rows = await h.db
      .select()
      .from(draftCommandLog)
      .where(eq(draftCommandLog.draftId, draftId));
    expect(rows.length).toBe(1);
  });

  // MULTI-CREDENTIAL — the load-bearing security property: the guard must check
  // EVERY inherited credential, not just the one the command happens to re-supply.
  // A source with TWO canonical credentials, where the command re-affirms ONE and
  // redirects the endpoint, must still REJECT — else the un-re-affirmed credential
  // rides Object.assign to the attacker host.
  it("REFUSES reconfiguring a multi-credential source when only ONE credential is re-affirmed", async () => {
    // Canonical source holding TWO top-level credential refs (apiKey + connectionString).
    const { result } = await h.app.call("addDataSource", {
      type: "rest",
      name: "TwoCred",
      apiKey: "secret-one",
      connectionString: "secret-two",
    });
    const id = (result as { id: string }).id;
    const before = await readConfig(h, id);
    expect(isSecretRef(before!.apiKey)).toBe(true);
    expect(isSecretRef(before!.connectionString)).toBe(true);

    const draftId = await h.controller.openDraft();
    await expect(
      h.controller.appendToDraft(draftId, [
        cmd("SetDataSourceConfig", {
          id,
          // Re-affirms apiKey only; connectionString is left inherited.
          apiKey: "rotated-one",
          extra: { endpoint: "https://attacker.example" },
        }),
      ]),
    ).rejects.toThrow(/inherited credential|silently redirected/i);

    // Nothing logged — the partial re-affirm did not slip through.
    const rows = await h.db
      .select()
      .from(draftCommandLog)
      .where(eq(draftCommandLog.draftId, draftId));
    expect(rows.length).toBe(0);
  });

  it("ALLOWS reconfiguring a multi-credential source when EVERY credential is re-affirmed", async () => {
    const { result } = await h.app.call("addDataSource", {
      type: "rest",
      name: "TwoCred",
      apiKey: "secret-one",
      connectionString: "secret-two",
    });
    const id = (result as { id: string }).id;

    const draftId = await h.controller.openDraft();
    // Both inherited credentials re-affirmed (apiKey re-supplied, connectionString
    // cleared) → no inherited secret carried → allowed.
    await h.controller.appendToDraft(draftId, [
      cmd("SetDataSourceConfig", {
        id,
        apiKey: "rotated-one",
        connectionString: "",
        extra: { endpoint: "https://api.example.com" },
      }),
    ]);

    const rows = await h.db
      .select()
      .from(draftCommandLog)
      .where(eq(draftCommandLog.draftId, draftId));
    expect(rows.length).toBe(1);
  });

  // Landmines the guard must NOT trip: create-then-configure in ONE draft (the new
  // source isn't canonical yet → no inherited credential) AND publish replay (the
  // guard runs only in capture, which replay bypasses). If either tripped, this
  // throws.
  it("ALLOWS create-then-configure in one draft and PUBLISHES (canonical-keyed + replay-exempt)", async () => {
    const id = crypto.randomUUID();
    const draftId = await h.controller.openDraft();

    await h.controller.appendToDraft(draftId, [
      cmd("CreateDataSource", {
        id,
        type: "rest",
        name: "Agent REST",
        apiKey: "agent-secret",
      }),
      cmd("SetDataSourceConfig", {
        id,
        extra: { endpoint: "https://api.example.com" },
      }),
    ]);

    await h.app.call("publishDraft", { draftId });

    const config = await readConfig(h, id);
    expect(config).not.toBeNull();
    expect(config!.endpoint).toBe("https://api.example.com");
    expect(isSecretRef(config!.apiKey)).toBe(true);
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

  // TOCTOU regression: a publish that FAILS DURING REPLAY (after
  // collection has already run inside the transaction via `beforeReplay`) must
  // release nothing. Unlike the duplicate-PK CreateDataSource rollback above
  // (which `collectSupersededRefs` never sees, since CreateDataSource is not a
  // credential-superseding command), this forces the failure on a draft that
  // DOES supersede a live credential ref — the exact case the ref-release list
  // is computed for — so the assertion is meaningful rather than vacuous.
  it("releases nothing when a credential-superseding publish fails mid-transaction", async () => {
    const { id, ref: oldRef } = await seedCanonicalSource(h, "orig-key");

    const draftId = await h.controller.openDraft();
    await h.controller.appendToDraft(draftId, [
      cmd("SetDataSourceConfig", { id, apiKey: "rotated-key" }),
    ]);
    const args = await firstLogArgs(h, draftId);
    const mintedRef = args.apiKey as SecretRef;

    // Fault-inject a failure INSIDE the publish transaction, after replay would
    // have run (mirrors the GH #157 fault injector in draft-controller.test.ts):
    // patch the tx-bound raw handle's `delete` to throw when it targets
    // `draftCommandLog` — the teardown step that runs immediately after replay,
    // inside the same commit boundary. `beforeReplay` (and therefore
    // `collectSupersededRefs`) has ALREADY run by this point — proving that even
    // though collection observed the superseded ref, a rolled-back transaction
    // still releases nothing.
    /* eslint-disable @typescript-eslint/no-explicit-any -- structural fault injector over the tracked-tx seam, mirrors draft-controller.test.ts GH#157 */
    const realCreateTracked = h.app.createTracked.bind(h.app);
    (h.app as any).createTracked = () => {
      const t = realCreateTracked();
      const realTx = t.transaction.bind(t);
      t.transaction = ((fn: any, opts: any) =>
        realTx(async (tx) => {
          const realDelete = tx.raw.delete.bind(tx.raw);
          tx.raw.delete = (table: any) => {
            if (table === draftCommandLog) {
              throw new Error("injected teardown failure");
            }
            return realDelete(table);
          };
          return fn(tx);
        }, opts)) as any;
      return t;
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */

    try {
      await expect(h.app.call("publishDraft", { draftId })).rejects.toThrow(
        "injected teardown failure",
      );

      // The whole publish transaction rolled back — canonical still holds the
      // OLD ref, and NEITHER ref was released (release only runs after
      // `publishDraft` resolves, and it never resolved).
      expect((await readConfig(h, id))!.apiKey).toBe(oldRef);
      expect(await h.vault.has(oldRef)).toBe(true);
      expect(await h.vault.has(mintedRef)).toBe(true);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- undo the structural fault injector patched above
      (h.app as any).createTracked = realCreateTracked;
    }
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

// ---------------------------------------------------------------------------
// AC#2 — Pre-release flush gate: publishDraft and discardDraft await
// flushSnapshot before releasing credential refs, so a crash between onWrite
// return and snapshot durability cannot leave a ref released-but-not-snapshotted.
// ---------------------------------------------------------------------------
describe("pre-release flush gate (flushSnapshot — transition-time path)", () => {
  let h: Harness;

  beforeEach(async () => {
    // No flushSnapshot by default — tests that need it construct their own harness.
    h = await makeHarness();
  });
  afterEach(async () => {
    await h.db.$client.close();
    rmSync(h.dir, { recursive: true, force: true });
  });

  // AC#2 core: when flushSnapshot is provided and succeeds, the publish path
  // releases the replaced canonical ref (the flush resolved → ref released).
  // ORDER MATTERS: the ref must still be present DURING the flush callback
  // (proving flush happens before release), and absent AFTER publish returns.
  it("publishDraft releases replaced ref after flushSnapshot succeeds", async () => {
    let refPresentDuringFlush: boolean | undefined;
    let flushAttempts = 0;
    const flushing = await makeHarness({
      flushSnapshot: async () => {
        flushAttempts++;
        // Capture vault state at flush time — the ref must still be live here.
        refPresentDuringFlush = await flushing.vault.has(oldRef);
      },
    });
    // Declared here so the flushSnapshot callback above can close over it.
    let oldRef!: SecretRef;
    try {
      const seeded = await seedCanonicalSource(flushing, "old-key");
      const id = seeded.id;
      oldRef = seeded.ref;
      const draftId = await flushing.controller.openDraft();
      await flushing.controller.appendToDraft(draftId, [
        cmd("SetDataSourceConfig", { id, apiKey: "new-key" }),
      ]);
      await flushing.app.call("publishDraft", { draftId });
      // flushSnapshot was invoked (the pre-release gate fired on credential refs)
      expect(flushAttempts).toBe(1);
      // the ref was still present DURING the flush — ordering invariant holds
      expect(refPresentDuringFlush).toBe(true);
      // old ref was released AFTER the flush resolved
      expect(await flushing.vault.has(oldRef)).toBe(false);
    } finally {
      await flushing.db.$client.close();
      rmSync(flushing.dir, { recursive: true, force: true });
    }
  });

  // AC#2 fail-safe: when flushSnapshot throws, the old ref is NOT released —
  // it becomes an inert orphan rather than a dangling live reference.
  // (Same invariant as the existing onWrite test, now using the durable gate.)
  it("publishDraft skips credential release when flushSnapshot fails", async () => {
    let flushAttempts = 0;
    const failing = await makeHarness({
      flushSnapshot: () => {
        flushAttempts++;
        return Promise.reject(new Error("disk full"));
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
      // Publish commits, but flushSnapshot throws → release is skipped,
      // leaving old ref as an inert orphan, NOT a dangling live reference.
      await failing.app.call("publishDraft", { draftId });
      // The gate was attempted (flushSnapshot was called, not silently skipped)
      expect(flushAttempts).toBeGreaterThanOrEqual(1);
      // Old ref was NOT released — inert orphan, not a dangling live reference
      expect(await failing.vault.has(oldRef)).toBe(true);
    } finally {
      await failing.db.$client.close();
      rmSync(failing.dir, { recursive: true, force: true });
    }
  });

  // AC#2 for discardDraft: same gate — discard uses flushSnapshot when it has
  // credential refs to release (draft-minted refs).
  // ORDER MATTERS: the minted ref must still be present DURING the flush callback
  // (proving flush happens before release), and absent AFTER discard returns.
  it("discardDraft releases minted ref after flushSnapshot succeeds", async () => {
    let refPresentDuringFlush: boolean | undefined;
    let flushAttempts = 0;
    // mintedRef is bound after appendToDraft; the callback closes over the let binding.
    let mintedRef!: SecretRef;
    const flushing = await makeHarness({
      flushSnapshot: async () => {
        flushAttempts++;
        // Capture vault state at flush time — ref must still be live here.
        refPresentDuringFlush = await flushing.vault.has(mintedRef);
      },
    });
    try {
      // Seed a canonical source so the draft can reference it
      const { id } = await seedCanonicalSource(flushing, "canonical-key");
      const draftId = await flushing.controller.openDraft();
      // Append a credential command — capture-before-log mints a new ref in the log
      await flushing.controller.appendToDraft(draftId, [
        cmd("SetDataSourceConfig", { id, apiKey: "draft-key" }),
      ]);
      // Read the minted ref from the log
      const logArgs = await firstLogArgs(flushing, draftId);
      mintedRef = logArgs.apiKey as SecretRef;
      expect(isSecretRef(mintedRef)).toBe(true);
      expect(await flushing.vault.has(mintedRef)).toBe(true);

      await flushing.app.call("discardDraft", { draftId });
      // flushSnapshot was invoked (the pre-release gate fired on credential refs)
      expect(flushAttempts).toBe(1);
      // the minted ref was still present DURING the flush — ordering invariant holds
      expect(refPresentDuringFlush).toBe(true);
      // minted ref released AFTER the flush resolved
      expect(await flushing.vault.has(mintedRef)).toBe(false);
    } finally {
      await flushing.db.$client.close();
      rmSync(flushing.dir, { recursive: true, force: true });
    }
  });

  // AC#2 fail-safe for discardDraft: if flushSnapshot fails, draft-minted refs
  // must NOT be released — they are inert orphans, not dangling live references.
  it("discardDraft skips credential release when flushSnapshot fails", async () => {
    let flushAttempts = 0;
    const failing = await makeHarness({
      flushSnapshot: () => {
        flushAttempts++;
        return Promise.reject(new Error("flush failed"));
      },
    });
    try {
      const { id } = await seedCanonicalSource(failing, "canonical-key");
      const draftId = await failing.controller.openDraft();
      await failing.controller.appendToDraft(draftId, [
        cmd("SetDataSourceConfig", { id, apiKey: "draft-key" }),
      ]);
      // Read the minted ref before discarding
      const logArgs = await firstLogArgs(failing, draftId);
      const mintedRef = logArgs.apiKey as SecretRef;
      expect(isSecretRef(mintedRef)).toBe(true);
      expect(await failing.vault.has(mintedRef)).toBe(true);

      // Discard — flushSnapshot fails → release must be skipped
      await failing.app.call("discardDraft", { draftId });
      // The gate was attempted (flushSnapshot was called, not silently skipped)
      expect(flushAttempts).toBeGreaterThanOrEqual(1);
      // Minted ref NOT released (safe inert orphan)
      expect(await failing.vault.has(mintedRef)).toBe(true);
    } finally {
      await failing.db.$client.close();
      rmSync(failing.dir, { recursive: true, force: true });
    }
  });

  // AC#2 isolation — no-flushSnapshot + onWrite-succeeds pin: when
  // credential refs are present but NO flushSnapshot hook is wired, a resolving
  // debounced onWrite MUST NOT satisfy the release gate.
  // "onWrite returned" != "durably persisted" — a future refactor that lets a
  // successful onWrite satisfy the gate would silently re-open the
  // crash-window for credentials (process exits between onWrite return and the
  // debounced write; old snapshot is restored; ref already released → dangling).
  it("publishDraft blocks credential release when flushSnapshot absent but onWrite succeeds", async () => {
    const onWriteCalls: number[] = [];
    const noHook = await makeHarness({
      onWrite: () => onWriteCalls.push(Date.now()), // onWrite present and resolves
      // flushSnapshot intentionally absent — the gate must block release here
    });
    try {
      const { id, ref: oldRef } = await seedCanonicalSource(
        noHook,
        "original-key",
      );
      // Release candidate is live before publish — the gate has something to block.
      expect(await noHook.vault.has(oldRef)).toBe(true);

      const draftId = await noHook.controller.openDraft();
      await noHook.controller.appendToDraft(draftId, [
        cmd("SetDataSourceConfig", { id, apiKey: "rotated-key" }),
      ]);
      await noHook.app.call("publishDraft", { draftId });

      // onWrite was invoked (proves the gate ran, not an early error — the
      // fail-closed branch calls onWrite for non-credential snapshot scheduling
      // before returning false). Combined with the vault assertion below, this
      // pins the no-flushSnapshot credential branch of the gate.
      expect(onWriteCalls).toHaveLength(1);
      // Credential ref NOT released — gate blocks because durability is unproven.
      expect(await noHook.vault.has(oldRef)).toBe(true);
    } finally {
      await noHook.db.$client.close();
      rmSync(noHook.dir, { recursive: true, force: true });
    }
  });

  // AC#2 isolation — discard twin: same invariant holds for discardDraft.
  it("discardDraft blocks credential release when flushSnapshot absent but onWrite succeeds", async () => {
    const onWriteCalls: number[] = [];
    const noHook = await makeHarness({
      onWrite: () => onWriteCalls.push(Date.now()), // onWrite present and resolves
      // flushSnapshot intentionally absent
    });
    try {
      const { id } = await seedCanonicalSource(noHook, "canonical-key");
      const draftId = await noHook.controller.openDraft();
      await noHook.controller.appendToDraft(draftId, [
        cmd("SetDataSourceConfig", { id, apiKey: "draft-key" }),
      ]);
      // capture-before-log minted a ref in the log — read it to assert it survives.
      const logArgs = await firstLogArgs(noHook, draftId);
      const mintedRef = logArgs.apiKey as SecretRef;
      expect(isSecretRef(mintedRef)).toBe(true);
      // Release candidate is live before discard — the gate has something to block.
      expect(await noHook.vault.has(mintedRef)).toBe(true);

      await noHook.app.call("discardDraft", { draftId });

      // onWrite was invoked (proves we reached the fail-closed branch, not an early error).
      expect(onWriteCalls).toHaveLength(1);
      // Minted credential ref NOT released — gate blocks because durability is unproven.
      expect(await noHook.vault.has(mintedRef)).toBe(true);
    } finally {
      await noHook.db.$client.close();
      rmSync(noHook.dir, { recursive: true, force: true });
    }
  });

  // Non-credential publish still uses the debounced onWrite path (no expensive
  // flush on every publish — only on credential-bearing ones).
  it("publishDraft uses onWrite (not flushSnapshot) when no credential refs are replaced", async () => {
    const onWriteCalls: number[] = [];
    const flushCalls: number[] = [];
    const mixed = await makeHarness({
      onWrite: () => onWriteCalls.push(Date.now()),
      flushSnapshot: async () => {
        flushCalls.push(Date.now());
      },
    });
    try {
      const draftId = await mixed.controller.openDraft();
      await mixed.controller.appendToDraft(draftId, [
        // No credential fields — this create has no apiKey/connectionString
        cmd("CreateDataSource", {
          id: crypto.randomUUID(),
          type: "csv",
          name: "NoCredential",
        }),
      ]);
      await mixed.app.call("publishDraft", { draftId });
      // No credential refs → debounced onWrite used, not flushSnapshot
      expect(onWriteCalls).toHaveLength(1);
      expect(flushCalls).toHaveLength(0);
    } finally {
      await mixed.db.$client.close();
      rmSync(mixed.dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// AC#3 — Legacy synchronous release path: direct canonical calls
// (setDataSourceConfig / deleteNode without a draft) flush the snapshot before
// releasing the superseded vault ref.
// ---------------------------------------------------------------------------
describe("pre-release flush gate (legacy direct canonical calls)", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await makeHarness();
  });
  afterEach(async () => {
    await h.db.$client.close();
    rmSync(h.dir, { recursive: true, force: true });
  });

  // AC#3 rotate: setDataSourceConfig direct canonical call flushes before release.
  it("setDataSourceConfig releases old ref after flushSnapshot on direct canonical call", async () => {
    const flushCalls: number[] = [];
    const flushing = await makeHarness({
      flushSnapshot: async () => {
        flushCalls.push(Date.now());
      },
    });
    try {
      const { id, ref: oldRef } = await seedCanonicalSource(
        flushing,
        "old-key",
      );
      // Direct canonical call — no draftId in context → deferRelease = false → legacy path
      await flushing.app.call("setDataSourceConfig", { id, apiKey: "new-key" });
      // flushSnapshot was called before the release
      expect(flushCalls).toHaveLength(1);
      // old ref was released after the flush
      expect(await flushing.vault.has(oldRef)).toBe(false);
    } finally {
      await flushing.db.$client.close();
      rmSync(flushing.dir, { recursive: true, force: true });
    }
  });

  // AC#3 fail-safe: if flushSnapshot throws on the legacy path, the old ref is
  // NOT released — inert orphan rather than dangling live reference.
  it("setDataSourceConfig skips credential release when flushSnapshot fails", async () => {
    const failing = await makeHarness({
      flushSnapshot: () => Promise.reject(new Error("flush failed")),
    });
    try {
      const { id, ref: oldRef } = await seedCanonicalSource(
        failing,
        "orig-key",
      );
      // Direct canonical call — flushSnapshot fails → skip release
      await failing.app.call("setDataSourceConfig", {
        id,
        apiKey: "rotated-key",
      });
      // Old ref NOT released (safe inert orphan, not a dangling live reference)
      expect(await failing.vault.has(oldRef)).toBe(true);
    } finally {
      await failing.db.$client.close();
      rmSync(failing.dir, { recursive: true, force: true });
    }
  });

  // AC#3 delete: deleteNode flushes snapshot before releasing data-source config refs.
  it("deleteNode/dataSource releases config refs after flushSnapshot", async () => {
    const flushCalls: number[] = [];
    const flushing = await makeHarness({
      flushSnapshot: async () => {
        flushCalls.push(Date.now());
      },
    });
    try {
      const { id, ref } = await seedCanonicalSource(flushing, "key");
      expect(await flushing.vault.has(ref)).toBe(true);
      // Direct canonical delete (no draft context)
      await flushing.app.call("deleteNode", { id });
      // flushSnapshot called before ref release
      expect(flushCalls).toHaveLength(1);
      // config ref released after the snapshot was flushed
      expect(await flushing.vault.has(ref)).toBe(false);
    } finally {
      await flushing.db.$client.close();
      rmSync(flushing.dir, { recursive: true, force: true });
    }
  });

  // AC#3 fail-safe for delete: if flushSnapshot fails, config refs must NOT be
  // released — inert orphan rather than dangling live reference.
  it("deleteNode/dataSource skips credential release when flushSnapshot fails", async () => {
    const failing = await makeHarness({
      flushSnapshot: () => Promise.reject(new Error("flush failed")),
    });
    try {
      const { id, ref } = await seedCanonicalSource(failing, "del-key");
      expect(await failing.vault.has(ref)).toBe(true);
      // Direct canonical delete — flushSnapshot fails → skip release
      await failing.app.call("deleteNode", { id });
      // Config ref NOT released (safe inert orphan)
      expect(await failing.vault.has(ref)).toBe(true);
    } finally {
      await failing.db.$client.close();
      rmSync(failing.dir, { recursive: true, force: true });
    }
  });

  // AC#3 clear: setDataSourceConfig with empty string clears the credential
  // (CLEAR branch) — same flush-before-release ordering applies.
  it("setDataSourceConfig clears credential after flushSnapshot (CLEAR branch)", async () => {
    const flushCalls: number[] = [];
    const flushing = await makeHarness({
      flushSnapshot: async () => {
        flushCalls.push(Date.now());
      },
    });
    try {
      const { id, ref } = await seedCanonicalSource(flushing, "to-be-cleared");
      // Clear the credential — empty string triggers CLEAR branch
      await flushing.app.call("setDataSourceConfig", { id, apiKey: "" });
      // flush before release
      expect(flushCalls).toHaveLength(1);
      // cleared ref is gone from vault
      expect(await flushing.vault.has(ref)).toBe(false);
    } finally {
      await flushing.db.$client.close();
      rmSync(flushing.dir, { recursive: true, force: true });
    }
  });
});
