import {
  draftCommandLog,
  openArtifactDb,
  schema,
} from "@dashframe/server-core";
import type { Principal } from "@wystack/identity";
import type { Command, WyStackApp } from "@wystack/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  buildDashframeApp,
  createDraftController,
  type DraftController,
} from "../app";
import { computeLogSignature } from "../draft-log-signature";
import { LOCAL_USER_ID } from "../permissions";
import { cmd } from "./commands";

const { dataSources } = schema;

describe("draft review RPC workflow", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: WyStackApp;
  let controller: DraftController;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-draft-review-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    app = await buildDashframeApp({ db });
    controller = createDraftController(app, db);
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const service: Principal = {
    kind: "service",
    credentialId: "credential-1",
  };
  const user: Principal = { kind: "user", userId: LOCAL_USER_ID };

  function context(principal: Principal) {
    return {
      wyStackApp: app,
      artifactDb: db,
      draftController: controller,
      principal,
    };
  }

  async function call<T>(
    path: string,
    args: Record<string, unknown>,
    principal: Principal = user,
  ): Promise<T> {
    const response = await app.call(path, args, context(principal));
    return response.result as T;
  }

  async function seedLateBound(
    ref: unknown,
    label = "source name",
  ): Promise<{ draftId: string; log: Command[]; signature: string }> {
    const draftId = await controller.openDraft();
    await db.insert(draftCommandLog).values({
      draftId,
      seq: 0,
      path: "createDataSource",
      args: {
        id: crypto.randomUUID(),
        type: "csv",
        name: {
          kind: "lateBound",
          label,
          ...(ref === undefined ? {} : { ref }),
        },
      },
    });
    const log = await controller.getDraftLog(draftId);
    return { draftId, log, signature: computeLogSignature(log) };
  }

  it("lets a service principal draft but denies direct commit and revision", async () => {
    const sourceId = crypto.randomUUID();
    const draftResponse = await app.call(
      "draftBatch",
      {
        commands: [
          cmd("CreateDataSource", {
            id: sourceId,
            type: "csv",
            name: "Service draft",
          }),
        ],
      },
      context(service),
    );
    const drafted = draftResponse.result as {
      draftId: string;
      __extraTablesWritten?: string[];
    };

    expect(await controller.getDraftLog(drafted.draftId)).toHaveLength(1);
    expect(await db.select().from(dataSources)).toHaveLength(0);
    // buildDashframeApp exposes the internal invalidation relay. The outer
    // HTTP server wrapper strips this field and merges it into tablesWritten;
    // that generic relay contract is covered in draft-lifecycle.test.ts.
    expect(drafted.__extraTablesWritten).toEqual(["draft_command_log"]);
    expect(
      await call<Array<{ draftId: string }>>("listDrafts", {}, service),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ draftId: drafted.draftId }),
      ]),
    );
    await expect(
      app.call(
        "commitBatch",
        {
          commands: [
            cmd("CreateDataSource", {
              id: crypto.randomUUID(),
              type: "csv",
              name: "Denied",
            }),
          ],
        },
        context(service),
      ),
    ).rejects.toThrow();
    const signature = computeLogSignature(
      await controller.getDraftLog(drafted.draftId),
    );
    await expect(
      app.call(
        "reviseDraft",
        {
          draftId: drafted.draftId,
          expectedLogSignature: signature,
          ops: [{ type: "removeCommand", commandIndex: 0 }],
        },
        context(service),
      ),
    ).rejects.toThrow();
  });

  it("lists metadata-only drafts and aggregated command summaries", async () => {
    const emptyDraftId = await controller.openDraft(new Date("2026-01-01"));
    const activeDraftId = await controller.openDraft(new Date("2026-01-02"));
    await controller.appendToDraft(
      activeDraftId,
      [
        cmd("CreateDataSource", {
          id: crypto.randomUUID(),
          type: "csv",
          name: "One",
        }),
        cmd("CreateDataSource", {
          id: crypto.randomUUID(),
          type: "csv",
          name: "Two",
        }),
      ],
      { principal: user },
    );

    const listed = await controller.listDrafts();
    expect(listed.map((draft) => draft.draftId)).toEqual(
      expect.arrayContaining([emptyDraftId, activeDraftId]),
    );
    expect(
      listed.find((draft) => draft.draftId === emptyDraftId),
    ).toMatchObject({
      commandCount: 0,
      updatedAt: null,
      kinds: {},
      paths: [],
    });
    expect(
      listed.find((draft) => draft.draftId === activeDraftId),
    ).toMatchObject({
      commandCount: 2,
      paths: ["createDataSource"],
    });
  });

  it("binds placeholders, removes commands, and densely re-sequences atomically", async () => {
    const seeded = await seedLateBound({
      type: "placeholder",
      prompt: "Source name",
    });
    await db.insert(draftCommandLog).values({
      draftId: seeded.draftId,
      seq: 1,
      path: "deleteNode",
      args: { id: crypto.randomUUID() },
    });
    const current = await controller.getDraftLog(seeded.draftId);
    const result = await call<{
      commandCount: number;
      logSignature: string;
    }>("reviseDraft", {
      draftId: seeded.draftId,
      expectedLogSignature: computeLogSignature(current),
      ops: [
        {
          type: "bindOperand",
          commandIndex: 0,
          jsonPath: "args.name",
          value: "Bound name",
        },
        { type: "removeCommand", commandIndex: 1 },
      ],
    });

    expect(result.commandCount).toBe(1);
    const log = await controller.getDraftLog(seeded.draftId);
    expect(log[0]?.args).toMatchObject({
      name: { kind: "value", v: "Bound name" },
    });
    expect(result.logSignature).toBe(computeLogSignature(log));
    const rows = await db
      .select({ seq: draftCommandLog.seq })
      .from(draftCommandLog);
    expect(rows).toEqual([{ seq: 0 }]);
  });

  it.each([
    ["category", { type: "category", handle: "gate-ref" }],
    ["column", { type: "column", columnId: "column-1" }],
    ["unknown", undefined],
  ] as const)(
    "rejects %s binding before drift checks and leaves the log unchanged",
    async (refType, ref) => {
      const seeded = await seedLateBound(ref);
      await expect(
        call("reviseDraft", {
          draftId: seeded.draftId,
          expectedLogSignature: "0".repeat(64),
          ops: [
            {
              type: "bindOperand",
              commandIndex: 0,
              jsonPath: "args.name",
              value: "must not persist",
              refType: "placeholder",
            },
          ],
        }),
      ).rejects.toThrow(`${refType} operands cannot be bound`);
      expect(await controller.getDraftLog(seeded.draftId)).toEqual(seeded.log);
    },
  );

  it("rejects a stale revision signature without changing the log", async () => {
    const seeded = await seedLateBound({ type: "placeholder" });
    await expect(
      call("reviseDraft", {
        draftId: seeded.draftId,
        expectedLogSignature: "0".repeat(64),
        ops: [{ type: "removeCommand", commandIndex: 0 }],
      }),
    ).rejects.toThrow("draft changed since review");
    expect(await controller.getDraftLog(seeded.draftId)).toEqual(seeded.log);
  });

  it("serializes concurrent appends to one draft into a dense log", async () => {
    const draftId = await controller.openDraft(
      undefined,
      `service:${service.credentialId}`,
    );
    await Promise.all([
      call(
        "draftBatch",
        {
          draftId,
          commands: [
            cmd("CreateDataSource", {
              id: crypto.randomUUID(),
              type: "csv",
              name: "First",
            }),
          ],
        },
        service,
      ),
      call(
        "draftBatch",
        {
          draftId,
          commands: [
            cmd("CreateDataSource", {
              id: crypto.randomUUID(),
              type: "csv",
              name: "Second",
            }),
          ],
        },
        service,
      ),
    ]);

    expect(await controller.getDraftLog(draftId)).toHaveLength(2);
    const rows = await db
      .select({ seq: draftCommandLog.seq })
      .from(draftCommandLog)
      .orderBy(draftCommandLog.seq);
    expect(rows).toEqual([{ seq: 0 }, { seq: 1 }]);
  });

  it("normalizes a queued append whose owned draft closes before execution", async () => {
    const ownerKey = `service:${service.credentialId}`;
    const draftId = await controller.openDraft(undefined, ownerKey);
    const original = controller;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    controller = {
      ...original,
      appendToDraft: async (...args) => {
        entered();
        await blocked;
        return original.appendToDraft(...args);
      },
    };

    const append = () =>
      call(
        "draftBatch",
        {
          draftId,
          commands: [
            cmd("CreateDashboard", {
              id: crypto.randomUUID(),
              name: "Queued close race",
            }),
          ],
        },
        service,
      );
    const first = append();
    await firstEntered;
    const queued = append();
    const firstRejected = expect(first).rejects.toThrow(
      /^draft is unavailable$/,
    );
    const queuedRejected = expect(queued).rejects.toThrow(
      /^draft is unavailable$/,
    );
    await original.discardDraft(draftId);
    release();

    await firstRejected;
    await queuedRejected;
  });
});
