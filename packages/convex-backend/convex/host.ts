import { replaceDraft } from "./app";
import { findLateBound } from "./late-bound";
import { redact } from "./preview";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { artifact } from "./schema";
import {
  object,
  json,
  command,
  typed,
  record,
  clean,
  type Json,
  type ObjectValue,
} from "./values";
import {
  find,
  rowValue,
  loadGraph,
  persist,
  draft,
  readGraph,
  log,
} from "./store";
import { cloneGraph, execute } from "./engine";
import { type ArtifactTable, type ArtifactRow } from "./model";
import { parseStoredDataTableState } from "./table-codec";
const workspace = { workspaceId: v.string() };
export const runtimeReady = internalQuery({
  args: {},
  returns: v.object({ ready: v.literal(true) }),
  handler: async () => ({ ready: true as const }),
});
export const initializeProject = internalMutation({
  args: {
    ...workspace,
    projectId: v.string(),
    name: v.string(),
    version: v.optional(v.string()),
    schemaVersion: v.optional(v.number()),
    createdBy: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workspaces")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();
    if (existing) {
      if (existing.projectId !== args.projectId)
        throw new Error("Workspace project identity mismatch");
      return null;
    }
    await ctx.db.insert("workspaces", {
      ...args,
      version: args.version ?? "0.3.0",
      schemaVersion: args.schemaVersion ?? 1,
      createdBy: args.createdBy ?? "local",
      createdAt: Date.now(),
    });
    return null;
  },
});
function getter(table: ArtifactTable) {
  return internalQuery({
    args: { ...workspace, id: v.string() },
    returns: v.union(artifact, v.null()),
    handler: async (ctx, args) => {
      const row = await find(ctx, args.workspaceId, table, args.id);
      return row ? rowValue(row) : null;
    },
  });
}
export const getDataSource = getter("dataSources");
export const getDataTable = getter("dataTables");
export const getDataFrame = getter("dataFrames");
export const getInsight = getter("insights");
export const listDataFramesByInsight = internalQuery({
  args: { ...workspace, insightId: v.string() },
  returns: v.array(artifact),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("dataFrames")
      .withIndex("by_workspaceId_and_insightId", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("insightId", args.insightId),
      )
      .take(1001);
    if (rows.length > 1000) throw new Error("Frame history limit exceeded");
    return rows.map(rowValue);
  },
});
export const revokeCredential = internalMutation({
  args: { ...workspace, credentialId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("revokedCredentials")
      .withIndex("by_workspaceId_and_credentialId", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("credentialId", args.credentialId),
      )
      .unique();
    if (!row) await ctx.db.insert("revokedCredentials", args);
    return null;
  },
});
function sanitizedAnalysis(value: Json): Json {
  if (Array.isArray(value)) return value.map(sanitizedAnalysis);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        k === "sampleValues" ? [] : sanitizedAnalysis(v),
      ]),
    );
  return value;
}
async function putFrame(
  ctx: MutationCtx,
  workspaceId: string,
  input: ObjectValue,
): Promise<void> {
  const id = String(input.id),
    storage = record(input.storage);
  if (storage.type !== "file" || storage.key !== id)
    throw new Error("Host frame storage must be its immutable UUID file");
  const old = await find(ctx, workspaceId, "dataFrames", id);
  if (old) throw new Error("Immutable frame already exists");
  const now = Date.now();
  await ctx.db.insert(
    "dataFrames",
    clean({
      ...input,
      id,
      workspaceId,
      revision: 1,
      name: String(input.name ?? "Data frame"),
      createdAt: typeof input.createdAt === "number" ? input.createdAt : now,
      updatedAt: now,
      analysis:
        input.analysis === undefined ? null : sanitizedAnalysis(input.analysis),
    }) as ArtifactRow,
  );
}
async function operation(
  ctx: QueryCtx,
  workspaceId: string,
  operationId: string,
  request: Json,
) {
  const existing = await ctx.db
    .query("operations")
    .withIndex("by_workspaceId_and_operationId", (q) =>
      q.eq("workspaceId", workspaceId).eq("operationId", operationId),
    )
    .unique();
  if (existing && JSON.stringify(existing.request) !== JSON.stringify(request))
    throw new Error("Operation ID reused with different payload");
  return existing;
}
export const commitImportedFrame = internalMutation({
  args: {
    ...workspace,
    dataTableId: v.string(),
    dataSourceId: v.string(),
    expectedDataFrameId: v.union(v.string(), v.null()),
    frameRow: object,
    tableUpdate: object,
    operationId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const request = clean({
        dataTableId: args.dataTableId,
        dataSourceId: args.dataSourceId,
        expectedDataFrameId: args.expectedDataFrameId,
        frameRow: args.frameRow,
        tableUpdate: args.tableUpdate,
      }),
      op = args.operationId ?? `import:${String(args.frameRow.id)}`;
    if (await operation(ctx, args.workspaceId, op, request)) return null;
    const table = await find(
      ctx,
      args.workspaceId,
      "dataTables",
      args.dataTableId,
    );
    if (
      !table ||
      table.dataSourceId !== args.dataSourceId ||
      (table.dataFrameId ?? null) !== args.expectedDataFrameId
    )
      throw new Error("SOURCE_BINDING_CHANGED");
    if (
      args.tableUpdate.dataSourceId !== undefined &&
      args.tableUpdate.dataSourceId !== args.dataSourceId
    )
      throw new Error("Source rebinding is not permitted");
    if (
      args.tableUpdate.id !== undefined &&
      args.tableUpdate.id !== args.dataTableId
    )
      throw new Error("Table id is immutable");
    if (args.tableUpdate.dataFrameId !== args.frameRow.id)
      throw new Error("Frame pointer mismatch");
    const allowed = new Set([
      "name",
      "table",
      "sourceSchema",
      "fields",
      "metrics",
      "dataFrameId",
      "lastFetchedAt",
    ]);
    if (Object.keys(args.tableUpdate).some((k) => !allowed.has(k)))
      throw new Error("Unsupported imported table update");
    parseStoredDataTableState(
      { ...table, ...args.tableUpdate },
      "Imported table",
    );
    await putFrame(ctx, args.workspaceId, args.frameRow);
    await ctx.db.patch(table._id, {
      ...args.tableUpdate,
      revision: table.revision + 1,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("operations", {
      workspaceId: args.workspaceId,
      operationId: op,
      request,
      result: null,
    });
    return null;
  },
});
export const getOperation = internalQuery({
  args: { ...workspace, operationId: v.string() },
  returns: v.union(object, v.null()),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("operations")
      .withIndex("by_workspaceId_and_operationId", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("operationId", args.operationId),
      )
      .unique();
    return row ? { request: row.request, result: row.result } : null;
  },
});
export const publishMaterialization = internalMutation({
  args: { ...workspace, value: object },
  returns: v.null(),
  handler: async (ctx, args) => {
    const value = args.value,
      target = record(value.target),
      result = record(value.result),
      sources = value.sources;
    if (!Array.isArray(sources)) throw new Error("Invalid source list");
    const op = `materialize:${String(result.id)}`;
    if (await operation(ctx, args.workspaceId, op, value)) return null;
    const fetchedAt = value.fetchedAt;
    if (typeof fetchedAt !== "number")
      throw new Error("Invalid fetch timestamp");
    for (const item of sources) {
      const { source: rawSource, frame: rawFrame } = record(item),
        source = record(rawSource),
        binding = record(source.table),
        frame = record(rawFrame);
      const table = await find(
        ctx,
        args.workspaceId,
        "dataTables",
        String(binding.id),
      );
      if (
        !table ||
        table.dataSourceId !== binding.dataSourceId ||
        table.table !== binding.table
      )
        throw new Error("SOURCE_BINDING_CHANGED");
      await putFrame(ctx, args.workspaceId, {
        ...frame,
        storage: { type: "file", key: frame.id! },
        name: binding.name!,
        sourceId: binding.dataSourceId!,
        definitionId: binding.id!,
        columnCount: Array.isArray(frame.fieldIds) ? frame.fieldIds.length : 0,
        analysis: {
          schema: frame.schema!,
          provenance: source.provenance!,
          fetchedAt,
        },
        lastRefreshedAt: fetchedAt,
      });
      await ctx.db.patch(table._id, {
        dataFrameId: String(frame.id),
        lastFetchedAt: fetchedAt,
        revision: table.revision + 1,
        updatedAt: Date.now(),
      });
    }
    if (target.kind !== "transient") {
      if (target.kind === "saved") {
        if (
          !(await find(
            ctx,
            args.workspaceId,
            "insights",
            String(target.insightId),
          ))
        )
          throw new Error("Insight unavailable");
        const prior = await ctx.db
          .query("dataFrames")
          .withIndex("by_workspaceId_and_insightId", (q) =>
            q
              .eq("workspaceId", args.workspaceId)
              .eq("insightId", String(target.insightId)),
          )
          .take(1001);
        if (prior.length > 1000)
          throw new Error("Frame history limit exceeded");
        for (const frame of prior)
          await ctx.db.patch(frame._id, {
            analysis: {
              ...(frame.analysis ? record(frame.analysis) : {}),
              currentInsightResult: false,
            },
            revision: frame.revision + 1,
          });
      }
      await putFrame(ctx, args.workspaceId, {
        id: result.id!,
        fieldIds: result.fieldIds!,
        rowCount: result.rowCount!,
        storage: { type: "file", key: result.id! },
        name:
          target.kind === "saved"
            ? `Insight ${target.insightId}`
            : "Live fetch",
        ...(target.kind === "saved" ? { insightId: target.insightId! } : {}),
        columnCount: Array.isArray(result.fieldIds)
          ? result.fieldIds.length
          : 0,
        analysis: {
          schema: result.schema!,
          definitionFingerprint: value.definitionFingerprint!,
          provenance: value.provenance!,
          fetchedAt,
          ...(target.kind === "saved" ? { currentInsightResult: true } : {}),
          ...(target.kind === "ephemeral"
            ? { lifecycle: { kind: "serverSession" } }
            : {}),
        },
        lastRefreshedAt: fetchedAt,
      });
    }
    await ctx.db.insert("operations", {
      workspaceId: args.workspaceId,
      operationId: op,
      request: value,
      result: null,
    });
    return null;
  },
});
export const replaceDataSourceConfig = internalMutation({
  args: { ...workspace, id: v.string(), expectedConfig: json, config: object },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await find(ctx, args.workspaceId, "dataSources", args.id);
    if (
      !row ||
      JSON.stringify(row.config ?? {}) !== JSON.stringify(args.expectedConfig)
    )
      throw new Error("DataSource config changed");
    for (const key of ["apiKey", "connectionString"])
      if (
        args.config[key] !== undefined &&
        (typeof args.config[key] !== "string" ||
          !/^secret:[0-9a-f-]{36}$/i.test(String(args.config[key])))
      )
        throw new Error("Credential must be a staged SecretRef");
    await ctx.db.patch(row._id, {
      config: args.config,
      revision: row.revision + 1,
      updatedAt: Date.now(),
    });
    return null;
  },
});
export const prepareRemoteDataTable = internalMutation({
  args: {
    ...workspace,
    id: v.string(),
    dataSourceId: v.string(),
    table: v.string(),
    fields: v.array(object),
  },
  returns: v.array(object),
  handler: async (ctx, args) => {
    const row = await find(ctx, args.workspaceId, "dataTables", args.id);
    if (
      !row ||
      row.dataSourceId !== args.dataSourceId ||
      row.table !== args.table
    )
      throw new Error("SOURCE_BINDING_CHANGED");
    const structural = (fields: ObjectValue[]) =>
      JSON.stringify(
        fields
          .map((f) => ({ name: f.columnName ?? f.name, type: f.type }))
          .sort((a, b) => String(a.name).localeCompare(String(b.name))),
      );
    if (row.fields?.length) {
      if (structural(row.fields) !== structural(args.fields))
        throw new Error("SOURCE_SCHEMA_CHANGED");
      return row.fields;
    }
    parseStoredDataTableState({ ...row, fields: args.fields }, "Remote fields");
    await ctx.db.patch(row._id, {
      fields: args.fields,
      revision: row.revision + 1,
      updatedAt: Date.now(),
    });
    return args.fields;
  },
});
export const commitStagedCommands = internalMutation({
  args: { ...workspace, commands: v.array(command), operationId: v.string() },
  returns: v.object({
    mode: v.literal("commit"),
    results: v.array(v.object({ id: v.optional(v.string()), value: json })),
    tablesWritten: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const prior = await operation(
      ctx,
      args.workspaceId,
      args.operationId,
      args.commands as unknown as Json,
    );
    if (prior)
      return prior.result as {
        mode: "commit";
        results: { id?: string; value: Json }[];
        tablesWritten: string[];
      };
    const before = await loadGraph(ctx, args.workspaceId),
      after = cloneGraph(before),
      results = execute(after, args.commands, args.workspaceId, Date.now(), {
        host: true,
      }),
      tablesWritten = await persist(ctx, args.workspaceId, before, after),
      result = { mode: "commit" as const, results, tablesWritten };
    await ctx.db.insert("operations", {
      workspaceId: args.workspaceId,
      operationId: args.operationId,
      request: args.commands as unknown as Json,
      result,
    });
    return result;
  },
});
const provider = v.object({
  id: v.string(),
  providerId: v.string(),
  displayLabel: v.string(),
  authKind: v.union(
    v.literal("api-key"),
    v.literal("local"),
    v.literal("oauth"),
  ),
  baseUrl: v.union(v.string(), v.null()),
  credentialRef: v.union(v.string(), v.null()),
  defaultModel: v.string(),
  isDefault: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
});
async function settings(ctx: QueryCtx, workspaceId: string, kind: string) {
  const rows = await ctx.db
    .query("hostSettings")
    .withIndex("by_workspaceId_and_kind_and_id", (q) =>
      q.eq("workspaceId", workspaceId).eq("kind", kind),
    )
    .take(1001);
  if (rows.length > 1000) throw new Error("Settings limit exceeded");
  return rows;
}
async function setting(
  ctx: QueryCtx,
  workspaceId: string,
  kind: string,
  id: string,
) {
  return ctx.db
    .query("hostSettings")
    .withIndex("by_workspaceId_and_kind_and_id", (q) =>
      q.eq("workspaceId", workspaceId).eq("kind", kind).eq("id", id),
    )
    .unique();
}
export const listAssistantProviderConfigs = internalQuery({
  args: workspace,
  returns: v.array(provider),
  handler: async (ctx, args) =>
    (await settings(ctx, args.workspaceId, "assistantProviderConfig")).map(
      (r) => r.value as typeof provider.type,
    ),
});
export const getAssistantProviderConfig = internalQuery({
  args: { ...workspace, id: v.string() },
  returns: v.union(provider, v.null()),
  handler: async (ctx, args) => {
    const row = await setting(
      ctx,
      args.workspaceId,
      "assistantProviderConfig",
      args.id,
    );
    return row ? (row.value as typeof provider.type) : null;
  },
});
export const saveAssistantProviderConfig = internalMutation({
  args: { ...workspace, row: provider, expected: v.union(provider, v.null()) },
  returns: provider,
  handler: async (ctx, args) => {
    const current = await setting(
      ctx,
      args.workspaceId,
      "assistantProviderConfig",
      args.row.id,
    );
    if (
      JSON.stringify(current?.value ?? null) !== JSON.stringify(args.expected)
    )
      throw new Error("Provider config changed");
    if (
      args.row.credentialRef &&
      !/^secret:[0-9a-f-]{36}$/i.test(args.row.credentialRef)
    )
      throw new Error("Only staged SecretRefs may be stored");
    if (args.row.isDefault)
      for (const other of await settings(
        ctx,
        args.workspaceId,
        "assistantProviderConfig",
      ))
        if (other.id !== args.row.id && other.value.isDefault)
          await ctx.db.patch(other._id, {
            value: { ...other.value, isDefault: false, updatedAt: Date.now() },
          });
    if (current) await ctx.db.patch(current._id, { value: args.row });
    else
      await ctx.db.insert("hostSettings", {
        workspaceId: args.workspaceId,
        kind: "assistantProviderConfig",
        id: args.row.id,
        value: args.row,
      });
    return args.row;
  },
});
export const removeAssistantProviderConfig = internalMutation({
  args: { ...workspace, id: v.string(), expected: provider },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await setting(
      ctx,
      args.workspaceId,
      "assistantProviderConfig",
      args.id,
    );
    if (!row || JSON.stringify(row.value) !== JSON.stringify(args.expected))
      throw new Error("Provider config changed");
    await ctx.db.delete(row._id);
    return null;
  },
});
const hostPrincipal = v.union(
  v.object({ kind: v.literal("user"), userId: v.string() }),
  v.object({ kind: v.literal("service"), credentialId: v.string() }),
);
async function hostIdentity(
  ctx: QueryCtx,
  workspaceId: string,
  p: typeof hostPrincipal.type,
) {
  if (p.kind === "user")
    return { workspaceId, kind: "user" as const, owner: `user:${p.userId}` };
  const revoked = await ctx.db
    .query("revokedCredentials")
    .withIndex("by_workspaceId_and_credentialId", (q) =>
      q.eq("workspaceId", workspaceId).eq("credentialId", p.credentialId),
    )
    .unique();
  if (revoked) throw new Error("Credential revoked");
  return {
    workspaceId,
    kind: "service" as const,
    owner: `service:${p.credentialId}`,
  };
}
export const commitBatch = internalMutation({
  args: {
    ...workspace,
    principal: hostPrincipal,
    commands: v.array(command),
    operationId: v.optional(v.string()),
  },
  returns: v.object({
    mode: v.literal("commit"),
    commands: v.array(command),
    results: v.array(v.object({ id: v.optional(v.string()), value: json })),
    tablesWritten: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const who = await hostIdentity(ctx, args.workspaceId, args.principal);
    if (who.kind !== "user") throw new Error("User permission required");
    if (findLateBound(args.commands).length)
      throw new Error("Unbound operands cannot be committed");
    const op = args.operationId;
    if (op) {
      const old = await operation(ctx, args.workspaceId, op, args.commands);
      if (old)
        return old.result as {
          mode: "commit";
          commands: typeof args.commands;
          results: { id?: string; value: Json }[];
          tablesWritten: string[];
        };
    }
    const before = await loadGraph(ctx, args.workspaceId),
      after = cloneGraph(before),
      results = execute(after, args.commands, args.workspaceId, Date.now(), {
        host: true,
      }),
      tablesWritten = await persist(ctx, args.workspaceId, before, after);
    const result = {
      mode: "commit" as const,
      commands: args.commands.map((c) => ({
        ...c,
        args: record(redact(c.args)),
      })),
      results,
      tablesWritten,
    };
    if (op)
      await ctx.db.insert("operations", {
        workspaceId: args.workspaceId,
        operationId: op,
        request: args.commands,
        result,
      });
    return result;
  },
});
export const draftBatch = internalMutation({
  args: {
    ...workspace,
    principal: hostPrincipal,
    commands: v.array(command),
    draftId: v.optional(v.string()),
  },
  returns: v.object({
    draftId: v.string(),
    results: v.array(v.object({ id: v.optional(v.string()), value: json })),
  }),
  handler: async (ctx, args) => {
    const who = await hostIdentity(ctx, args.workspaceId, args.principal);
    let row;
    if (args.draftId) row = await draft(ctx, who, args.draftId, true);
    else {
      const now = Date.now(),
        draftId = crypto.randomUUID(),
        id = await ctx.db.insert("drafts", {
          workspaceId: args.workspaceId,
          draftId,
          owner: who.owner,
          revision: 0,
          createdAt: now,
          updatedAt: now,
          commandCount: 0,
        });
      row = (await ctx.db.get(id))!;
    }
    const before = await loadGraph(ctx, args.workspaceId),
      after = await readGraph(ctx, who, row.draftId),
      commands = [
        ...(await log(ctx, args.workspaceId, row.draftId)).map(
          (e) => e.command,
        ),
        ...args.commands,
      ],
      results = execute(after, args.commands, args.workspaceId, Date.now(), {
        host: true,
        service: who.kind === "service",
      });
    await replaceDraft(ctx, row, commands, before, after);
    return { draftId: row.draftId, results };
  },
});
