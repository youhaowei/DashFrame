import { expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { FunctionArgs } from "convex/server";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.ts");
type Prepare = FunctionArgs<typeof internal.host.prepareHostBatch>;

it("reports a losing settlement as conflict without cancelling the winner", async () => {
  const t = convexTest(schema, modules);
  const winner: Prepare = {
    workspaceId: "w",
    operationId: crypto.randomUUID(),
    principal: { kind: "user", userId: "u" },
    requestHash: "a".repeat(64),
    mode: "commit",
    stagedRefs: [],
    commands: [
      {
        path: "createDataSource",
        args: {
          id: crypto.randomUUID(),
          name: "Winner",
          type: "csv",
        },
      },
    ],
  };
  await t.mutation(internal.host.prepareHostBatch, winner);

  expect(
    await t.mutation(internal.host.settleHostBatch, {
      workspaceId: winner.workspaceId,
      operationId: winner.operationId,
      principal: winner.principal,
      requestHash: "b".repeat(64),
      stagedRefs: [],
    }),
  ).toEqual({ status: "conflict", result: null });

  expect(
    (
      await t.mutation(internal.host.executeHostBatch, {
        workspaceId: winner.workspaceId,
        operationId: winner.operationId,
        principal: winner.principal,
        requestHash: winner.requestHash,
      })
    ).status,
  ).toBe("completed");
});

it("reaps a failed attempt while allowing the same operation to prepare fresh refs", async () => {
  const t = convexTest(schema, modules);
  const firstRef = `secret:${crypto.randomUUID()}`;
  const nextRef = `secret:${crypto.randomUUID()}`;
  const first: Prepare = {
    workspaceId: "w",
    operationId: crypto.randomUUID(),
    principal: { kind: "user", userId: "u" },
    requestHash: "a".repeat(64),
    mode: "commit",
    stagedRefs: [firstRef],
    commands: [
      {
        path: "createDataSource",
        args: {
          id: crypto.randomUUID(),
          name: "First attempt",
          type: "http",
          apiKey: firstRef,
        },
      },
    ],
  };
  await t.mutation(internal.host.prepareHostBatch, first);

  expect(
    await t.mutation(internal.host.settleHostBatch, {
      workspaceId: first.workspaceId,
      operationId: first.operationId,
      principal: first.principal,
      requestHash: first.requestHash,
      stagedRefs: first.stagedRefs,
      retryable: true,
    }),
  ).toEqual({ status: "pending", result: null });
  expect(
    await t.mutation(internal.host.claimCleanup, {
      workspaceId: "w",
      cleanupId: (
        await t.query(internal.host.listCleanup, {
          workspaceId: "w",
          paginationOpts: { cursor: null, numItems: 100 },
        })
      ).page[0]!.cleanupId,
    }),
  ).toMatchObject({ kind: "secret", resourceId: firstRef });

  const next = {
    ...first,
    stagedRefs: [nextRef],
    commands: [
      {
        ...first.commands[0]!,
        args: { ...first.commands[0]!.args, apiKey: nextRef },
      },
    ],
  };
  expect(await t.mutation(internal.host.prepareHostBatch, next)).toEqual({
    status: "pending",
    result: null,
  });
  expect(
    (
      await t.mutation(internal.host.executeHostBatch, {
        workspaceId: next.workspaceId,
        operationId: next.operationId,
        principal: next.principal,
        requestHash: next.requestHash,
      })
    ).status,
  ).toBe("completed");
});
