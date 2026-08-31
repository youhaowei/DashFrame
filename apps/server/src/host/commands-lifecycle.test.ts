/// <reference types="vite/client" />
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { convexTest } from "convex-test";
import schema from "@dashframe/convex-backend/schema";
import { api } from "@dashframe/convex-backend/api";
import type { LocalConvex } from "@dashframe/convex-local";
import { CREDENTIAL_CLASS } from "@dashframe/server-core";
import {
  InMemoryMappingStore,
  SecretRegistry,
  SecretVault,
  TestBackend,
  type SecretRef,
} from "@wystack/secret-vault";
import { cmd } from "@dashframe/types";
import type { HostContext } from "./context";
import { createHostMetadata } from "./convex-metadata";
import {
  executeHostCommandBatch,
  HostBatchOutcomeUnknownError,
  HostBatchRejectedError,
} from "./commands";
import { HostResourceCleanup } from "./resource-cleanup";

const modules = import.meta.glob(
  "../../../../packages/convex-backend/convex/**/*.ts",
);
const makeNative = () => convexTest(schema, modules);
let native: ReturnType<typeof makeNative>;
let ctx: HostContext;
let cleanup: HostResourceCleanup;
let refs: SecretRef[];
let storeCredential: SecretVault["store"];
const user = () =>
  native.withIdentity({
    subject: "u",
    workspaceId: "w",
    principalKind: "user",
    userId: "u",
  });
beforeEach(() => {
  native = makeNative();
  const registry = new SecretRegistry();
  registry.register("test", new TestBackend());
  registry.setClassDefault(CREDENTIAL_CLASS.ConnectorKey, "test");
  const vault = new SecretVault(registry, new InMemoryMappingStore());
  const store = vault.store.bind(vault);
  storeCredential = store;
  refs = [];
  vi.spyOn(vault, "store").mockImplementation(async (...args) => {
    const ref = await store(...args);
    refs.push(ref);
    return ref;
  });
  ctx = {
    principal: { kind: "user", userId: "u" },
    vault,
    metadata: createHostMetadata(
      {
        query: native.query,
        mutation: native.mutation,
      } as unknown as LocalConvex["internalClient"],
      "w",
    ),
    getServerEndpoint: () => undefined,
  };
  cleanup = new HostResourceCleanup(ctx);
  ctx.cleanupResources = () => cleanup.run();
});
afterEach(async () => {
  await cleanup.close();
  vi.restoreAllMocks();
});
const create = (id = crypto.randomUUID(), key = "synthetic-secret") => ({
  commands: [
    cmd("CreateDataSource", { id, name: "Source", type: "http", apiKey: key }),
  ],
});

describe("staged credential lifecycle", () => {
  it("releases the first credential when the second vault store fails", async () => {
    let calls = 0;
    vi.spyOn(ctx.vault!, "store").mockImplementation(async (...args) => {
      if (++calls === 2) throw new Error("vault unavailable");
      const ref = await storeCredential(...args);
      refs.push(ref);
      return ref;
    });
    await expect(
      executeHostCommandBatch(
        ctx,
        {
          commands: [
            cmd("CreateDataSource", {
              id: crypto.randomUUID(),
              name: "Source",
              type: "http",
              apiKey: "first",
              connectionString: "second",
            }),
          ],
        },
        "commit",
      ),
    ).rejects.toBeInstanceOf(HostBatchRejectedError);
    expect(refs).toHaveLength(1);
    expect(await ctx.vault!.has(refs[0]!)).toBe(false);
  });
  it("releases every staged credential after a later command rolls back", async () => {
    const input = create();
    await expect(
      executeHostCommandBatch(
        ctx,
        {
          commands: [
            ...input.commands,
            cmd("SetDataSourceConfig", {
              id: crypto.randomUUID(),
              apiKey: "other",
            }),
          ],
        },
        "commit",
      ),
    ).rejects.toBeInstanceOf(HostBatchRejectedError);
    expect(refs).toHaveLength(2);
    for (const ref of refs) expect(await ctx.vault!.has(ref)).toBe(false);
    expect(await user().query(api.app.listDataSources, {})).toEqual([]);
  });
  it("deletes the superseded ref after a confirmed rotation but keeps the current one", async () => {
    const id = crypto.randomUUID();
    await executeHostCommandBatch(ctx, create(id), "commit");
    await executeHostCommandBatch(
      ctx,
      { commands: [cmd("SetDataSourceConfig", { id, apiKey: "replacement" })] },
      "commit",
    );
    expect(await ctx.vault!.has(refs[0]!)).toBe(false);
    expect(await ctx.vault!.has(refs[1]!)).toBe(true);
    expect((await ctx.metadata.getDataSource(id))?.config?.apiKey).toBe(
      refs[1],
    );
  });
  it("confirms a lost commit acknowledgement and retries without minting another ref", async () => {
    const execute = ctx.metadata.executeHostBatch.bind(ctx.metadata);
    vi.spyOn(ctx.metadata, "executeHostBatch").mockImplementationOnce(
      async (input) => {
        await execute(input);
        throw new Error("lost response");
      },
    );
    const input = { ...create(), operationId: crypto.randomUUID() };
    const first = await executeHostCommandBatch(ctx, input, "commit");
    expect(await executeHostCommandBatch(ctx, input, "commit")).toEqual(first);
    expect(refs).toHaveLength(1);
    expect(await ctx.vault!.has(refs[0]!)).toBe(true);
  });
  it("retains an uncertain staged ref, then cancels and cleans it on restart", async () => {
    vi.spyOn(ctx.metadata, "executeHostBatch").mockRejectedValueOnce(
      new Error("offline"),
    );
    vi.spyOn(ctx.metadata, "settleHostBatch").mockRejectedValueOnce(
      new Error("offline"),
    );
    await expect(
      executeHostCommandBatch(ctx, create(), "commit"),
    ).rejects.toBeInstanceOf(HostBatchOutcomeUnknownError);
    expect(await ctx.vault!.has(refs[0]!)).toBe(true);
    await cleanup.recoverPendingBatches();
    await cleanup.run();
    expect(await ctx.vault!.has(refs[0]!)).toBe(false);
    expect(await user().query(api.app.listDataSources, {})).toEqual([]);
  });
  it("exposes a retryable operation ID even when an older caller omits one", async () => {
    const execute = vi
      .spyOn(ctx.metadata, "executeHostBatch")
      .mockRejectedValueOnce(new Error("offline"));
    vi.spyOn(ctx.metadata, "settleHostBatch").mockRejectedValueOnce(
      new Error("offline"),
    );
    const input = create();
    const error = await executeHostCommandBatch(ctx, input, "commit").catch(
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(HostBatchOutcomeUnknownError);
    expect(error).toMatchObject({
      operationId: execute.mock.calls[0]![0].operationId,
      code: "HOST_BATCH_OUTCOME_UNKNOWN",
    });
    const operationId = (error as HostBatchOutcomeUnknownError).operationId;
    const result = await executeHostCommandBatch(
      ctx,
      { ...input, operationId },
      "commit",
    );
    expect(result).toMatchObject({ mode: "commit" });
    expect(refs).toHaveLength(1);
  });
  it("retries failed vault deletion from the durable cleanup record", async () => {
    const id = crypto.randomUUID();
    await executeHostCommandBatch(ctx, create(id), "commit");
    vi.spyOn(ctx.vault!, "delete").mockRejectedValueOnce(
      new Error("keychain unavailable"),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await user().mutation(api.app.commitBatch, {
      commands: [cmd("DeleteNode", { id })],
    });
    await cleanup.run();
    expect(await ctx.vault!.has(refs[0]!)).toBe(true);
    await cleanup.run();
    expect(await ctx.vault!.has(refs[0]!)).toBe(false);
  });
});
