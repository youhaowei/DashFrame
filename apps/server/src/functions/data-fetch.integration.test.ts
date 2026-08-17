/** Registered RPC boundary tests for the live Insight fetch lifecycle. */
import { openArtifactDb, schema } from "@dashframe/server-core";
import type { Principal } from "@wystack/identity";
import type { WyStackApp } from "@wystack/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { LOCAL_USER_ID } from "../permissions";
import { wy } from "../wystack";
import { cmd, commandFunctions } from "./commands";
import {
  createDataFetchFunctions,
  fingerprintEffectiveInsight,
  type LiveFetchExecutor,
} from "./data-fetch";

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
      definitionFingerprint: fingerprintEffectiveInsight(insight),
      provenance: { connectorKind: "test", bindingVersion: "v1" },
      fetchedAt: 1,
      ...(target.kind === "saved" ? { target } : {}),
    }));
    const dataFetch = createDataFetchFunctions(execute);
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
        cmd("AddField", {
          nodeId: tableId,
          field: {
            id: "country",
            name: "Country",
            tableId,
            columnName: "country",
            type: "string",
          },
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

  async function seedLastSuccessful(insightId: string, analysis: unknown) {
    const id = crypto.randomUUID();
    await db.insert(schema.dataFrames).values({
      id,
      storage: { type: "file", key: id },
      fieldIds: ["country"],
      name: "Previous result",
      insightId,
      rowCount: 3,
      columnCount: 1,
      analysis: analysis as never,
      lastRefreshedAt: new Date(1),
    });
    return id;
  }

  it("accepts a typed ephemeral definition from user and service principals without persisting an Insight row", async () => {
    const sourceId = crypto.randomUUID();
    const tableId = crypto.randomUUID();
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
      ],
      { mode: "commit", context: { principal: user } },
    );
    for (const principal of [user, service]) {
      const result = await call(
        "fetchData",
        {
          insight: {
            baseTableId: tableId,
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

  it("fails ephemeral source resolution before execution for an unknown identity", async () => {
    const result = await call("fetchData", {
      insight: {
        baseTableId: crypto.randomUUID(),
        selectedFields: ["country"],
        metrics: [],
      },
    });

    expect(result).toMatchObject({
      status: "failed",
      code: "TARGET_NOT_READY",
    });
    expect(execute).not.toHaveBeenCalled();
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

  it("preserves saved Insight-on-Insight source wiring for recursive execution", async () => {
    const upstreamId = await seedSavedInsight();
    const derivedId = crypto.randomUUID();
    const { applyCommands } = await import("@wystack/server");
    await applyCommands(
      app,
      [
        cmd("CreateInsight", {
          id: derivedId,
          name: "Derived",
          source: { sourceType: "insight", sourceId: upstreamId },
          selectedFields: ["country"],
        }),
      ],
      { mode: "commit", context: { principal: user } },
    );

    const initial = await call("runInsight", { insightId: derivedId });
    expect(initial).toMatchObject({
      status: "ready",
    });
    expect(execute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        insight: expect.objectContaining({
          baseTableId: upstreamId,
          source: { sourceType: "insight", sourceId: upstreamId },
        }),
      }),
    );

    const previousId = await seedLastSuccessful(derivedId, {
      schema: [{ id: "country", name: "country", type: "string" }],
      definitionFingerprint: (initial as { definitionFingerprint: string })
        .definitionFingerprint,
      provenance: { connectorKind: "test", bindingVersion: "v1" },
      fetchedAt: 1,
    });
    execute.mockResolvedValueOnce({
      status: "failed",
      code: "FETCH_EXECUTION_FAILED",
      message: "safe failure",
      retryable: true,
      diagnosticId: "composed-failure",
    });
    await expect(
      call("runInsight", { insightId: derivedId }),
    ).resolves.toMatchObject({
      status: "failed",
      lastSuccessful: { stale: true, dataFrameId: previousId },
    });
  });

  it("returns a safe runtime failure before execution for malformed operator values", async () => {
    const insightId = await seedSavedInsight();
    const { applyCommands } = await import("@wystack/server");
    await applyCommands(
      app,
      [
        cmd("SetInsightFilter", {
          id: insightId,
          filters: [
            {
              id: "date-range",
              field: "date",
              operator: "between",
              value: { low: "2026-01-01", high: "2026-01-31" },
            },
          ],
        } as never),
        cmd("SetInsightRuntimeControls", {
          id: insightId,
          runtimeControls: {
            filters: [{ key: "dates", filterId: "date-range", label: "Dates" }],
          },
        }),
      ],
      { mode: "commit", context: { principal: user } },
    );
    await seedLastSuccessful(insightId, {
      schema: [{ id: "date", name: "date", type: "date" }],
      definitionFingerprint: "prior-valid-invocation",
      provenance: { connectorKind: "test", bindingVersion: "v1" },
      fetchedAt: 1,
    });
    execute.mockClear();

    const result = await call("runInsight", {
      insightId,
      runtime: { filters: { dates: "not-a-range" } },
    });

    expect(result).toMatchObject({
      status: "failed",
      code: "RUNTIME_FILTER_VALUE_INVALID",
      message: "The requested Insight runtime controls are invalid.",
      retryable: false,
    });
    expect(execute).not.toHaveBeenCalled();
    expect(
      (result as { lastSuccessful?: unknown }).lastSuccessful,
    ).toBeUndefined();
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

  it("attaches strictly validated prior metadata to a returned saved-materialization failure", async () => {
    const insightId = await seedSavedInsight();
    const initial = (await call("runInsight", { insightId })) as {
      definitionFingerprint: string;
    };
    const frameId = await seedLastSuccessful(insightId, {
      schema: [{ id: "country", name: "country", type: "string" }],
      definitionFingerprint: initial.definitionFingerprint,
      provenance: { connectorKind: "test", bindingVersion: "v1" },
      fetchedAt: 1,
    });
    execute.mockResolvedValueOnce({
      status: "failed",
      code: "FETCH_EXECUTION_FAILED",
      message: "safe failure",
      retryable: true,
      diagnosticId: "diagnostic",
    });

    const result = await call("runInsight", { insightId });

    expect(result).toMatchObject({
      status: "failed",
      lastSuccessful: {
        stale: true,
        dataFrameId: frameId,
        definitionFingerprint: initial.definitionFingerprint,
      },
    });
    // Reading stale metadata must not detach or mutate the retained frame.
    expect(
      (await db.select().from(schema.dataFrames)).find(
        (row) => row.id === frameId,
      )?.insightId,
    ).toBe(insightId);
  });

  it("does not attach a stale frame from a different effective invocation", async () => {
    const insightId = await seedSavedInsight();
    await seedLastSuccessful(insightId, {
      schema: [{ id: "country", name: "country", type: "string" }],
      definitionFingerprint: "different-runtime-or-definition",
      provenance: { connectorKind: "test", bindingVersion: "v1" },
      fetchedAt: 1,
    });
    execute.mockResolvedValueOnce({
      status: "failed",
      code: "FETCH_EXECUTION_FAILED",
      message: "safe failure",
      retryable: true,
      diagnosticId: "diagnostic",
    });

    const result = await call("runInsight", { insightId });

    expect(result).toMatchObject({ status: "failed" });
    expect(
      (result as { lastSuccessful?: unknown }).lastSuccessful,
    ).toBeUndefined();
  });

  it("omits malformed or absent saved prior metadata and all ephemeral failures", async () => {
    const insightId = await seedSavedInsight();
    await seedLastSuccessful(insightId, {
      schema: [],
      // malformed: no definition fingerprint/provenance/fetchedAt
    });
    execute.mockResolvedValueOnce({
      status: "failed",
      code: "FETCH_EXECUTION_FAILED",
      message: "safe failure",
      retryable: true,
      diagnosticId: "malformed",
    });
    const malformed = await call("runInsight", { insightId });
    expect(malformed).toMatchObject({
      status: "failed",
    });
    expect(
      (malformed as { lastSuccessful?: unknown }).lastSuccessful,
    ).toBeUndefined();

    const noPriorInsightId = await seedSavedInsight();
    execute.mockResolvedValueOnce({
      status: "failed",
      code: "FETCH_EXECUTION_FAILED",
      message: "safe failure",
      retryable: true,
      diagnosticId: "none",
    });
    const noPrior = await call("runInsight", { insightId: noPriorInsightId });
    expect(noPrior).toMatchObject({ status: "failed" });
    expect(
      (noPrior as { lastSuccessful?: unknown }).lastSuccessful,
    ).toBeUndefined();

    execute.mockResolvedValueOnce({
      status: "failed",
      code: "FETCH_EXECUTION_FAILED",
      message: "safe failure",
      retryable: true,
      diagnosticId: "ephemeral",
    });
    const ephemeral = await call("fetchData", {
      insight: {
        baseTableId: crypto.randomUUID(),
        selectedFields: ["country"],
        metrics: [],
      },
    });
    expect(ephemeral).toMatchObject({ status: "failed" });
    expect(
      (ephemeral as { lastSuccessful?: unknown }).lastSuccessful,
    ).toBeUndefined();
  });
});
