/// <reference types="vite/client" />
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { convexTest } from "convex-test";
import schema from "@dashframe/convex-backend/schema";
import { api } from "@dashframe/convex-backend/api";
import type { LocalConvex } from "@dashframe/convex-local";
import { CREDENTIAL_CLASS } from "@dashframe/server-core";
import {
  InMemoryMappingStore,
  makeSecretRef,
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
import { cmd, COMMAND_PATHS } from "@dashframe/types";
import type { HostContext } from "./context";
import { createHostMetadata } from "./convex-metadata";
import {
  executeHostCommandBatch,
  HostBatchOutcomeUnknownError,
} from "./commands";

const modules = import.meta.glob(
  "../../../../packages/convex-backend/convex/**/*.ts",
);
const userIdentity = {
  subject: "u",
  workspaceId: "w",
  principalKind: "user",
  userId: "u",
};

let native: ReturnType<typeof convexTest>;
let ctx: HostContext;

beforeEach(() => {
  native = convexTest(schema, modules);
  const registry = new SecretRegistry();
  registry.register("test", new TestBackend());
  registry.setClassDefault(CREDENTIAL_CLASS.ConnectorKey, "test");
  ctx = {
    principal: { kind: "user", userId: "u" },
    vault: new SecretVault(registry, new InMemoryMappingStore()),
    metadata: createHostMetadata(
      {
        query: native.query,
        mutation: native.mutation,
      } as unknown as LocalConvex["internalClient"],
      "w",
    ),
    getServerEndpoint: () => undefined,
  };
});

describe("host batch retry fence", () => {
  it("hashes credential presence without hashing credential values or staged refs", async () => {
    const hashes: string[] = [];
    const refs: string[] = [];
    vi.spyOn(ctx.vault!, "store").mockImplementation(async () => {
      const ref = makeSecretRef();
      refs.push(ref);
      return ref;
    });
    vi.spyOn(ctx.metadata, "prepareHostBatch").mockImplementation(
      async (input) => {
        hashes.push(input.requestHash);
        return {
          status: "completed",
          result: {
            mode: "commit",
            commands: input.commands,
            results: [],
            tablesWritten: [],
          },
        };
      },
    );

    const run = (
      path: string,
      args: Record<string, unknown>,
      credentials: Record<string, string>,
    ) =>
      executeHostCommandBatch(
        ctx,
        {
          commands: [{ path, args: { ...args, ...credentials } }],
        },
        "commit",
      );
    for (const [path, args] of [
      [
        COMMAND_PATHS.GetOrCreateDataSource,
        { id: crypto.randomUUID(), name: "Existing", type: "http" },
      ],
      [
        COMMAND_PATHS.CreateDataSource,
        { id: crypto.randomUUID(), name: "New", type: "http" },
      ],
      [COMMAND_PATHS.SetDataSourceConfig, { id: crypto.randomUUID() }],
    ] as const) {
      const first = hashes.length;
      await run(path, args, { apiKey: "first-plaintext" });
      await run(path, args, { apiKey: "second-plaintext" });
      expect(refs[first]).not.toBe(refs[first + 1]);
      expect(hashes[first]).toBe(hashes[first + 1]);
    }

    const base = {
      id: crypto.randomUUID(),
      name: "Stable",
      type: "http",
    };
    await run(COMMAND_PATHS.CreateDataSource, base, {
      apiKey: "first-plaintext",
    });
    await run(COMMAND_PATHS.CreateDataSource, base, {
      connectionString: "postgres://credential",
    });
    await run(
      COMMAND_PATHS.CreateDataSource,
      { ...base, name: "Different" },
      {
        apiKey: "first-plaintext",
      },
    );

    expect(hashes[7]).not.toBe(hashes[6]);
    expect(hashes[8]).not.toBe(hashes[6]);
  });

  it("keeps a deterministic mutation failure retryable under the same operation ID", async () => {
    const id = crypto.randomUUID();
    const input = {
      operationId: crypto.randomUUID(),
      commands: [cmd("RenameNode", { id, name: "Recovered" })],
    };

    await expect(
      executeHostCommandBatch(ctx, input, "commit"),
    ).rejects.toBeInstanceOf(HostBatchOutcomeUnknownError);

    await native.withIdentity(userIdentity).mutation(api.app.commitBatch, {
      commands: [cmd("CreateDataSource", { id, name: "Before", type: "csv" })],
    });

    await expect(
      executeHostCommandBatch(ctx, input, "commit"),
    ).resolves.toMatchObject({ mode: "commit" });
    expect((await ctx.metadata.getDataSource(id))?.name).toBe("Recovered");
  });
});
