/**
 * draftBatch + reviseDraft — API entry and fix-in-place (Acceptance B).
 */
import {
  ApiAccessCredentials,
  openProject,
  schema,
  type ProjectHandle,
} from "@dashframe/server-core";
import {
  InMemoryMappingStore,
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildDashframeApp,
  createDashframeServer,
  createDraftController,
  type DashframeServer,
  type DraftController,
} from "../app";
import { computeLogSignature } from "../draft-log-signature";
import { cmd } from "./commands";

const USER_TOKEN = "renderer-token";

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function makeAccessCredentials(rootDir: string): ApiAccessCredentials {
  const registry = new SecretRegistry();
  registry.register("test", new TestBackend(), { fallback: true });
  registry.setClassDefault("serve-token", "test");
  return new ApiAccessCredentials(
    new SecretVault(registry, new InMemoryMappingStore()),
    rootDir,
  );
}

async function post(
  server: DashframeServer,
  path: string,
  body: unknown,
  token: string,
): Promise<Response> {
  return fetch(`${server.url}/api/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...bearer(token),
    },
    body: JSON.stringify(body),
  });
}

async function get(
  server: DashframeServer,
  path: string,
  args: unknown,
  token: string,
): Promise<Response> {
  const url = new URL(`${server.url}/api/${path}`);
  url.searchParams.set("args", JSON.stringify(args));
  return fetch(url, { headers: { ...bearer(token) } });
}

describe("draftBatch and reviseDraft", () => {
  let root: string;
  let project: ProjectHandle | null;
  let server: DashframeServer | null;
  let serviceToken: string;
  let accessCredentials: ApiAccessCredentials;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "dashframe-draft-batch-"));
    project = await openProject({ dir: join(root, "project") });
    accessCredentials = makeAccessCredentials(join(root, "credentials"));
    ({ token: serviceToken } = await accessCredentials.issue("Test service"));
    server = null;
  });

  afterEach(async () => {
    server?.stop();
    await project?.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("lets a service principal draft but not commit, and leaves canonical empty", async () => {
    server = await createDashframeServer({
      db: project!.db,
      accessCredentials,
      authToken: USER_TOKEN,
    });

    const sourceId = crypto.randomUUID();
    const commands = [
      cmd("CreateDataSource", {
        id: sourceId,
        type: "csv",
        name: "Drafted source",
      }),
    ];

    const drafted = await post(
      server,
      "draftBatch",
      { commands },
      serviceToken,
    );
    expect(drafted.status).toBe(200);
    const draftPayload = (await drafted.json()) as {
      data: {
        draftId: string;
        results: unknown[];
        __extraTablesWritten?: unknown;
      };
    };
    expect(draftPayload.data.draftId).toBeTruthy();
    expect(draftPayload.data.results).toHaveLength(1);
    // Stripped before client response.
    expect(draftPayload.data.__extraTablesWritten).toBeUndefined();
    expect(await project!.db.select().from(schema.dataSources)).toHaveLength(0);

    const denied = await post(
      server,
      "commitBatch",
      { commands },
      serviceToken,
    );
    expect(denied.status).toBe(403);
    expect(await project!.db.select().from(schema.dataSources)).toHaveLength(0);

    const listed = await get(server, "listDrafts", {}, serviceToken);
    expect(listed.status).toBe(200);
    const listPayload = (await listed.json()) as {
      data: Array<{ draftId: string; commandCount: number }>;
    };
    expect(listPayload.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          draftId: draftPayload.data.draftId,
          commandCount: 1,
        }),
      ]),
    );
  });

  it("denies reviseDraft to a service principal", async () => {
    server = await createDashframeServer({
      db: project!.db,
      accessCredentials,
      authToken: USER_TOKEN,
    });

    const draftRes = await post(
      server,
      "draftBatch",
      {
        commands: [
          cmd("CreateDataSource", {
            id: crypto.randomUUID(),
            type: "csv",
            name: "x",
          }),
        ],
      },
      serviceToken,
    );
    const { data } = (await draftRes.json()) as { data: { draftId: string } };

    const reviewRes = await get(
      server,
      "draftPublishReview",
      { draftId: data.draftId },
      USER_TOKEN,
    );
    const review = (await reviewRes.json()) as {
      data: { logSignature: string };
    };

    const denied = await post(
      server,
      "reviseDraft",
      {
        draftId: data.draftId,
        expectedLogSignature: review.data.logSignature,
        ops: [{ type: "removeCommand", commandIndex: 0 }],
      },
      serviceToken,
    );
    expect(denied.status).toBe(403);
  });

  it("rejects bindOperand on category/column/unknown and ignores client refType", async () => {
    server = await createDashframeServer({
      db: project!.db,
      accessCredentials,
      authToken: USER_TOKEN,
    });

    // Seed a log row with three late-bound shapes via direct table write so we
    // control ref types without going through command handlers.
    const draftId = crypto.randomUUID();
    await project!.db.insert(schema.draftMetadata).values({
      draftId,
      baseVersion: new Date(),
      baseInventory: {},
    });
    await project!.db.insert(schema.draftCommandLog).values([
      {
        draftId,
        seq: 0,
        path: "setInsightFilter",
        args: {
          id: crypto.randomUUID(),
          field: "a",
          operator: "eq",
          value: {
            kind: "lateBound",
            ref: { type: "category", handle: "h1" },
          },
        },
      },
      {
        draftId,
        seq: 1,
        path: "setInsightFilter",
        args: {
          id: crypto.randomUUID(),
          field: "b",
          operator: "eq",
          value: {
            kind: "lateBound",
            ref: { type: "column", fieldId: crypto.randomUUID() },
          },
        },
      },
      {
        draftId,
        seq: 2,
        path: "setInsightFilter",
        args: {
          id: crypto.randomUUID(),
          field: "c",
          operator: "eq",
          value: { kind: "lateBound", label: "no-ref" },
        },
      },
    ]);

    const controller = createDraftController(
      // Minimal app surface unused for reviseDraft path under test.
      { createTracked: () => project!.db } as never,
      project!.db,
    );
    const log = await controller.getDraftLog(draftId);
    const signature = computeLogSignature(log);

    for (const [commandIndex, jsonPath] of [
      [0, "args.value"],
      [1, "args.value"],
      [2, "args.value"],
    ] as const) {
      const res = await post(
        server,
        "reviseDraft",
        {
          draftId,
          expectedLogSignature: signature,
          ops: [
            {
              type: "bindOperand",
              commandIndex,
              jsonPath,
              value: "leaked",
              // Client-supplied refType must be ignored (PIN 4.9a).
              refType: "placeholder",
            },
          ],
        },
        USER_TOKEN,
      );
      expect(res.status).toBe(500);
    }

    // Log unchanged — no plaintext landed.
    const after = await controller.getDraftLog(draftId);
    expect(computeLogSignature(after)).toBe(signature);
    expect(JSON.stringify(after)).not.toContain("leaked");
  });

  it("binds a placeholder operand and rejects a stale expectedLogSignature", async () => {
    server = await createDashframeServer({
      db: project!.db,
      accessCredentials,
      authToken: USER_TOKEN,
    });

    const draftId = crypto.randomUUID();
    await project!.db.insert(schema.draftMetadata).values({
      draftId,
      baseVersion: new Date(),
      baseInventory: {},
    });
    await project!.db.insert(schema.draftCommandLog).values({
      draftId,
      seq: 0,
      path: "setInsightFilter",
      args: {
        id: crypto.randomUUID(),
        field: "name",
        operator: "eq",
        value: {
          kind: "lateBound",
          ref: { type: "placeholder", prompt: "Name filter" },
          label: "Name filter",
        },
      },
    });

    const controller = createDraftController(
      { createTracked: () => project!.db } as never,
      project!.db,
    );
    const log = await controller.getDraftLog(draftId);
    const signature = computeLogSignature(log);

    const stale = await post(
      server,
      "reviseDraft",
      {
        draftId,
        expectedLogSignature: "0".repeat(64),
        ops: [
          {
            type: "bindOperand",
            commandIndex: 0,
            jsonPath: "args.value",
            value: "Acme",
          },
        ],
      },
      USER_TOKEN,
    );
    expect(stale.status).toBe(500);
    expect(computeLogSignature(await controller.getDraftLog(draftId))).toBe(
      signature,
    );

    const ok = await post(
      server,
      "reviseDraft",
      {
        draftId,
        expectedLogSignature: signature,
        ops: [
          {
            type: "bindOperand",
            commandIndex: 0,
            jsonPath: "args.value",
            value: "Acme",
          },
        ],
      },
      USER_TOKEN,
    );
    expect(ok.status).toBe(200);
    const bound = await controller.getDraftLog(draftId);
    const value = (bound[0]!.args as { value: { kind: string; v: unknown } })
      .value;
    expect(value).toEqual({ kind: "value", v: "Acme" });
  });

  it("serializes concurrent draftBatch calls on one draftId to a dense seq", async () => {
    server = await createDashframeServer({
      db: project!.db,
      accessCredentials,
      authToken: USER_TOKEN,
    });

    // Open once, then fan out two concurrent appends.
    const open = await post(
      server,
      "draftBatch",
      {
        commands: [
          cmd("CreateDataSource", {
            id: crypto.randomUUID(),
            type: "csv",
            name: "seed",
          }),
        ],
      },
      serviceToken,
    );
    const { data } = (await open.json()) as { data: { draftId: string } };
    const draftId = data.draftId;

    const batchA = Array.from({ length: 5 }, (_, i) =>
      cmd("CreateDataSource", {
        id: crypto.randomUUID(),
        type: "csv",
        name: `A-${i}`,
      }),
    );
    const batchB = Array.from({ length: 5 }, (_, i) =>
      cmd("CreateDataSource", {
        id: crypto.randomUUID(),
        type: "csv",
        name: `B-${i}`,
      }),
    );

    const [r1, r2] = await Promise.all([
      post(server, "draftBatch", { commands: batchA, draftId }, serviceToken),
      post(server, "draftBatch", { commands: batchB, draftId }, serviceToken),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const rows = await project!.db
      .select({ seq: schema.draftCommandLog.seq })
      .from(schema.draftCommandLog)
      .where(
        // drizzle eq imported via schema filter would be cleaner; use raw filter
        // on all rows for this draft.
        (await import("drizzle-orm")).eq(
          schema.draftCommandLog.draftId,
          draftId,
        ),
      );

    const seqs = rows.map((r) => r.seq).sort((a, b) => a - b);
    // seed + 5 + 5 = 11 dense 0..10
    expect(seqs).toEqual(Array.from({ length: 11 }, (_, i) => i));
  });

  it("cleans an empty generated draft before a queued append can commit", async () => {
    const app = await buildDashframeApp({ db: project!.db });
    const baseController = createDraftController(app, project!.db);
    const principal = {
      kind: "service" as const,
      credentialId: "queued-service",
    };
    const context = {
      wyStackApp: app,
      artifactDb: project!.db,
      principal,
    };

    let resolveOpened!: (draftId: string) => void;
    const opened = new Promise<string>((resolve) => {
      resolveOpened = resolve;
    });
    let resolveFirstAppend!: () => void;
    const firstAppend = new Promise<void>((resolve) => {
      resolveFirstAppend = resolve;
    });
    let releaseFirstAppend!: () => void;
    const firstAppendRelease = new Promise<void>((resolve) => {
      releaseFirstAppend = resolve;
    });
    let resolveSecondValidated!: () => void;
    const secondValidated = new Promise<void>((resolve) => {
      resolveSecondValidated = resolve;
    });
    let resolveSecondStarted!: () => void;
    const secondStarted = new Promise<void>((resolve) => {
      resolveSecondStarted = resolve;
    });
    let resolveSecondCommitted!: () => void;
    const secondCommitted = new Promise<void>((resolve) => {
      resolveSecondCommitted = resolve;
    });

    let ownershipChecks = 0;
    let appendCalls = 0;
    let cleanupWaiting = false;
    let cleanupFinished = false;
    const controller: DraftController = {
      ...baseController,
      async openDraft(baseVersion, ownerPrincipalKey) {
        const draftId = await baseController.openDraft(
          baseVersion,
          ownerPrincipalKey,
        );
        resolveOpened(draftId);
        return draftId;
      },
      async draftOwnedBy(draftId, ownerPrincipalKey) {
        ownershipChecks += 1;
        if (ownershipChecks === 2) resolveSecondValidated();
        if (cleanupWaiting && !cleanupFinished) return true;
        return baseController.draftOwnedBy(draftId, ownerPrincipalKey);
      },
      async appendToDraft(draftId, batch, appendContext) {
        appendCalls += 1;
        if (appendCalls === 1) {
          resolveFirstAppend();
          await firstAppendRelease;
          throw new Error("first batch failed before any write");
        }
        resolveSecondStarted();
        const result = await baseController.appendToDraft(
          draftId,
          batch,
          appendContext,
        );
        resolveSecondCommitted();
        return result;
      },
      async discardDraft(draftId, options) {
        cleanupWaiting = true;
        await Promise.race([
          secondStarted,
          new Promise<void>((resolve) => setTimeout(resolve, 100)),
        ]);
        if (appendCalls > 1) await secondCommitted;
        await baseController.discardDraft(draftId, options);
        cleanupFinished = true;
      },
    };
    const callContext = { ...context, draftController: controller };
    const command = cmd("CreateDataSource", {
      id: crypto.randomUUID(),
      type: "csv",
      name: "queued append",
    });

    const firstResult = app
      .call("draftBatch", { commands: [command] }, callContext)
      .then(
        () => null,
        (error: unknown) => error,
      );
    await firstAppend;
    const draftId = await opened;

    const queuedResult = app
      .call(
        "draftBatch",
        {
          draftId,
          commands: [
            cmd("CreateDataSource", {
              id: crypto.randomUUID(),
              type: "csv",
              name: "must not be swept",
            }),
          ],
        },
        callContext,
      )
      .then(
        () => null,
        (error: unknown) => error,
      );
    await secondValidated;
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseFirstAppend();

    expect(await firstResult).toEqual(
      new Error("first batch failed before any write"),
    );
    expect(await queuedResult).toEqual(new Error("draft is unavailable"));
    expect(appendCalls).toBe(1);
    expect(await baseController.draftExists(draftId)).toBe(false);
    expect(await baseController.getDraftLog(draftId)).toEqual([]);
  });
});
