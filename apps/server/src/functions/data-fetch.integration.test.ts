/** Registered RPC boundary tests for the live Insight fetch lifecycle. */
import { openArtifactDb, schema } from "@dashframe/server-core";
import type { Principal } from "@wystack/identity";
import type { WyStackApp } from "@wystack/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LOCAL_USER_ID } from "../permissions";
import { wy } from "../wystack";
import { cmd, commandFunctions } from "./commands";
import { createDataFetchFunctions, type LiveFetchExecutor } from "./data-fetch";

const user: Principal = { kind: "user", userId: LOCAL_USER_ID };
const service: Principal = { kind: "service", credentialId: "service-key" };

describe("registered live Insight fetch procedures", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: WyStackApp;
  let execute: ReturnType<typeof vi.fn<LiveFetchExecutor>>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-fetch-rpc-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    execute = vi.fn(async ({ insight, target }) => ({
      status: "ready" as const,
      dataFrameId: crypto.randomUUID(),
      schema: insight.selectedFields.map((id) => ({
        id,
        name: id,
        type: "string",
      })),
      rowCount: 1,
      definitionFingerprint: "deterministic",
      provenance: { connectorKind: "test", bindingVersion: "v1" },
      fetchedAt: 1,
      ...(target.kind === "saved" ? { target } : {}),
    }));
    const dataFetch = createDataFetchFunctions(
      async () => ({ connectorKind: "test", sourceBindingVersion: "v1" }),
      execute,
    );
    app = await wy.build({
      db,
      functions: { ...commandFunctions, ...dataFetch },
    });
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function call(
    path: string,
    args: unknown,
    principal: Principal | null = user,
  ) {
    const { result } = await app.call(
      path,
      args,
      principal ? { principal } : {},
    );
    return result;
  }

  async function seedSavedInsight() {
    const sourceId = crypto.randomUUID();
    const tableId = crypto.randomUUID();
    const insightId = crypto.randomUUID();
    const { applyCommands } = await import("@wystack/server");
    await applyCommands(
      app,
      [
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "Source" }),
        cmd("CreateDataTable", {
          id: tableId,
          dataSourceId: sourceId,
          name: "Table",
          table: "source.csv",
        }),
        cmd("CreateInsight", {
          id: insightId,
          name: "Saved",
          source: { sourceType: "dataTable", sourceId: tableId },
          selectedFields: ["country"],
        }),
      ],
      { mode: "commit", context: { principal: user } },
    );
    return insightId;
  }

  it("accepts a typed ephemeral definition from user and service principals without persisting an Insight row", async () => {
    for (const principal of [user, service]) {
      const result = await call(
        "fetchData",
        {
          insight: {
            baseTableId: crypto.randomUUID(),
            selectedFields: ["country"],
            metrics: [],
          },
        },
        principal,
      );

      expect(result).toMatchObject({
        status: "ready",
        schema: [{ id: "country" }],
      });
    }

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: "ephemeral" },
        insight: expect.objectContaining({ selectedFields: ["country"] }),
      }),
    );
    expect(await db.select().from(schema.insights)).toHaveLength(0);
  });

  it("uses the saved definition for runInsight for user and service principals", async () => {
    const insightId = await seedSavedInsight();
    const result = await call("runInsight", {
      insightId,
      runtime: { limit: 10 },
    });

    expect(result).toMatchObject({
      status: "failed",
      code: "RUNTIME_LIMIT_OUT_OF_RANGE",
    });
    expect(execute).not.toHaveBeenCalled();

    for (const principal of [user, service]) {
      const ready = await call("runInsight", { insightId }, principal);
      expect(ready).toMatchObject({ status: "ready" });
    }
    expect(execute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        target: { kind: "saved", insightId },
        insight: expect.objectContaining({
          baseTableId: expect.any(String),
          selectedFields: ["country"],
        }),
      }),
    );
  });

  it("denies anonymous fetch and run requests before connector execution", async () => {
    await expect(
      call(
        "fetchData",
        {
          insight: {
            baseTableId: crypto.randomUUID(),
            selectedFields: [],
            metrics: [],
          },
        },
        null,
      ),
    ).rejects.toMatchObject({ name: "PermissionDeniedError" });

    await expect(
      call("runInsight", { insightId: crypto.randomUUID() }, null),
    ).rejects.toMatchObject({ name: "PermissionDeniedError" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects caller-selected provider and execution internals at the RPC boundary", async () => {
    const result = await call("fetchData", {
      insight: {
        baseTableId: crypto.randomUUID(),
        selectedFields: [],
        metrics: [],
        provider: "other",
        resourceId: "resource",
        credentials: { token: "secret" },
        fields: [{ id: "complete-field" }],
        sql: "select *",
        executionStage: "publish",
        placement: "server",
      },
    });
    expect(result).toMatchObject({
      status: "failed",
      code: "FETCH_INVALID_DEFINITION",
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
