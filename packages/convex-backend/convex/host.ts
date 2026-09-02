import {
  assertResourcesWritable,
  enqueueCleanup,
  enqueueRemovedResources,
  resources,
  secretResources,
} from "./cleanup";
import { hostPrincipal } from "./lifecycleValues";
import { stable } from "./values";
import { publicationMetadata } from "./publication";
import { artifactTables, isResourceReferenceScanCapError } from "./model";
import { replaceDraft } from "./app";
import { findLateBound } from "./lateBound";
import { externallyReferencedFrameIds } from "./frameRetention";
import { redact } from "./preview";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { artifact, localImportState } from "./schema";
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
import {
  type ArtifactTable,
  type ArtifactRow,
  type DataSourceRow,
  type DataTableRow,
  type DataFrameRow,
  type InsightRow,
} from "./model";
import { parseStoredDataTableState } from "./tableCodec";
const workspace = { workspaceId: v.string() };
/** Extend this predicate when another frame kind, such as a pinned snapshot, must survive pruning. */
function shouldRetainInsightFrame(
  frame: { id: string },
  previousFrameId: string | undefined,
  externallyReferenced: ReadonlySet<string>,
) {
  return frame.id === previousFrameId || externallyReferenced.has(frame.id);
}
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
export const getDataSource = internalQuery({
  args: { ...workspace, id: v.string() },
  returns: typed<DataSourceRow | null>(v.union(object, v.null())),
  handler: async (ctx, args) => {
    const row = await find(ctx, args.workspaceId, "dataSources", args.id);
    return row ? (rowValue(row) as unknown as DataSourceRow) : null;
  },
});
export const getDataTable = internalQuery({
  args: { ...workspace, id: v.string() },
  returns: typed<DataTableRow | null>(v.union(object, v.null())),
  handler: async (ctx, args) => {
    const row = await find(ctx, args.workspaceId, "dataTables", args.id);
    return row ? (rowValue(row) as unknown as DataTableRow) : null;
  },
});
export const getDataFrame = internalQuery({
  args: { ...workspace, id: v.string() },
  returns: typed<DataFrameRow | null>(v.union(object, v.null())),
  handler: async (ctx, args) => {
    const row = await find(ctx, args.workspaceId, "dataFrames", args.id);
    return row ? (rowValue(row) as unknown as DataFrameRow) : null;
  },
});
export const getInsight = internalQuery({
  args: { ...workspace, id: v.string() },
  returns: typed<InsightRow | null>(v.union(object, v.null())),
  handler: async (ctx, args) => {
    const row = await find(ctx, args.workspaceId, "insights", args.id);
    return row ? (rowValue(row) as unknown as InsightRow) : null;
  },
});
export const listDataFramesByInsight = internalQuery({
  args: { ...workspace, insightId: v.string() },
  returns: typed<DataFrameRow[]>(v.array(object)),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("dataFrames")
      .withIndex("by_workspaceId_and_insightId", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("insightId", args.insightId),
      )
      .take(1001);
    if (rows.length > 1000) throw new Error("Frame history limit exceeded");
    return rows.map((row) => rowValue(row) as unknown as DataFrameRow);
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
  await assertResourcesWritable(ctx, workspaceId, input);
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
  if (existing && stable(existing.request) !== stable(request))
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
    requestHash: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    let claim: Awaited<ReturnType<typeof importClaim>> = null;
    if (args.requestHash !== undefined) {
      if (!args.operationId)
        throw new Error("Import requestHash requires operationId");
      claim = await importClaim(
        ctx,
        args.workspaceId,
        args.operationId,
        args.requestHash,
      );
      if (!claim) throw new Error("Local import claim missing");
      if (claim.frameId !== args.frameRow.id)
        throw new Error("Local import frame differs from claim");
      if (claim.status === "complete") return null;
      if (
        args.tableUpdate.lastFetchedAt !== claim.fetchedAt ||
        args.frameRow.lastRefreshedAt !== claim.fetchedAt
      )
        throw new Error("Local import timestamp differs from claim");
      for (const key of ["rowCount", "columnCount"]) {
        const count = args.frameRow[key];
        if (
          typeof count !== "number" ||
          !Number.isSafeInteger(count) ||
          count < 0
        )
          throw new Error(`Invalid imported ${key}`);
      }
    }

    const request = clean({
        dataTableId: args.dataTableId,
        dataSourceId: args.dataSourceId,
        expectedDataFrameId: args.expectedDataFrameId,
        frameRow: sanitizedAnalysis(args.frameRow),
        tableUpdate: args.tableUpdate,
      }),
      op = claim
        ? `local-import:${args.operationId}`
        : (args.operationId ?? `import:${String(args.frameRow.id)}`);
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
    if (claim)
      await ctx.db.patch(claim._id, {
        status: "complete",
        result: {
          dataFrameId: claim.frameId,
          rowCount: args.frameRow.rowCount as number,
          columnCount: args.frameRow.columnCount as number,
          fetchedAt: claim.fetchedAt,
        },
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
  args: { ...workspace, value: publicationMetadata },
  returns: v.null(),
  handler: async (ctx, args) => {
    const value = args.value,
      { target, result, sources } = value;
    const op = `materialize:${result.id}`;
    if (await operation(ctx, args.workspaceId, op, value)) return null;
    const fetchedAt = value.fetchedAt;
    if (typeof fetchedAt !== "number")
      throw new Error("Invalid fetch timestamp");
    for (const item of sources) {
      const { source, frame } = item,
        binding = source.table;
      const table = await find(ctx, args.workspaceId, "dataTables", binding.id);
      if (
        !table ||
        table.dataSourceId !== binding.dataSourceId ||
        table.table !== binding.table
      )
        throw new Error("SOURCE_BINDING_CHANGED");
      await putFrame(ctx, args.workspaceId, {
        id: frame.id,
        fieldIds: frame.fieldIds,
        rowCount: frame.rowCount,
        storage: { type: "file", key: frame.id },
        name: binding.name,
        sourceId: binding.dataSourceId,
        definitionId: binding.id,
        columnCount: frame.fieldIds.length,
        analysis: {
          schema: frame.schema,
          provenance: source.provenance,
          fetchedAt,
        },
        lastRefreshedAt: fetchedAt,
      });
      await ctx.db.patch(table._id, {
        dataFrameId: frame.id,
        lastFetchedAt: fetchedAt,
        revision: table.revision + 1,
        updatedAt: Date.now(),
      });
    }
    if (target.kind !== "transient") {
      if (target.kind === "saved") {
        if (!(await find(ctx, args.workspaceId, "insights", target.insightId)))
          throw new Error("Insight unavailable");
        const prior = await ctx.db
          .query("dataFrames")
          .withIndex("by_workspaceId_and_insightId", (q) =>
            q
              .eq("workspaceId", args.workspaceId)
              .eq("insightId", target.insightId),
          )
          .take(1001);
        if (prior.length > 1000)
          throw new Error("Frame history limit exceeded");
        const byFreshness = (
          a: (typeof prior)[number],
          b: (typeof prior)[number],
        ) =>
          (b.lastRefreshedAt ?? b.createdAt) -
          (a.lastRefreshedAt ?? a.createdAt);
        const previousFrameId =
          prior
            .filter(
              (frame) =>
                frame.analysis &&
                record(frame.analysis).currentInsightResult === true,
            )
            .sort(byFreshness)[0]?.id ?? [...prior].sort(byFreshness)[0]?.id;
        const prunableCandidates = prior.filter(
          (frame) => frame.id !== previousFrameId,
        );
        let externallyReferenced = new Set<string>();
        if (prunableCandidates.length) {
          try {
            externallyReferenced = await externallyReferencedFrameIds(
              ctx,
              args.workspaceId,
              prunableCandidates,
            );
          } catch (error) {
            if (!isResourceReferenceScanCapError(error)) throw error;
            externallyReferenced = new Set(
              prunableCandidates.map((frame) => frame.id),
            );
          }
        }
        for (const frame of prior) {
          if (
            shouldRetainInsightFrame(
              frame,
              previousFrameId,
              externallyReferenced,
            )
          ) {
            await ctx.db.patch(frame._id, {
              analysis: {
                ...(frame.analysis ? record(frame.analysis) : {}),
                currentInsightResult: false,
              },
              revision: frame.revision + 1,
            });
          } else {
            await enqueueCleanup(
              ctx,
              args.workspaceId,
              resources(frame).values(),
            );
            await ctx.db.delete(frame._id);
          }
        }
      }
      await putFrame(ctx, args.workspaceId, {
        id: result.id,
        fieldIds: result.fieldIds,
        rowCount: result.rowCount,
        storage: { type: "file", key: result.id },
        name:
          target.kind === "saved"
            ? `Insight ${target.insightId}`
            : "Live fetch",
        ...(target.kind === "saved" ? { insightId: target.insightId } : {}),
        columnCount: result.fieldIds.length,
        analysis: {
          schema: result.schema,
          definitionFingerprint: value.definitionFingerprint,
          provenance: value.provenance,
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
    if (!row || stable(row.config ?? {}) !== stable(args.expectedConfig))
      throw new Error("DataSource config changed");
    for (const key of ["apiKey", "connectionString"])
      if (
        args.config[key] !== undefined &&
        (typeof args.config[key] !== "string" ||
          !/^secret:[0-9a-f-]{36}$/i.test(String(args.config[key])))
      )
        throw new Error("Credential must be a staged SecretRef");
    await assertResourcesWritable(ctx, args.workspaceId, args.config);
    await enqueueRemovedResources(
      ctx,
      args.workspaceId,
      row.config,
      args.config,
    );
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
      stable(
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
    if (stable(current?.value ?? null) !== stable(args.expected))
      throw new Error("Provider config changed");
    if (
      args.row.credentialRef &&
      !/^secret:[0-9a-f-]{36}$/i.test(args.row.credentialRef)
    )
      throw new Error("Only staged SecretRefs may be stored");
    await assertResourcesWritable(ctx, args.workspaceId, args.row);
    await enqueueRemovedResources(
      ctx,
      args.workspaceId,
      current?.value,
      args.row,
    );
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
    if (!row || stable(row.value) !== stable(args.expected))
      throw new Error("Provider config changed");
    await enqueueCleanup(ctx, args.workspaceId, resources(row.value).values());
    await ctx.db.delete(row._id);
    return null;
  },
});
export async function hostIdentity(
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
  handler: runHostCommit,
});
export async function runHostCommit(
  ctx: MutationCtx,
  args: {
    workspaceId: string;
    principal: typeof hostPrincipal.type;
    commands: (typeof command.type)[];
    operationId?: string;
  },
) {
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
}

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
  handler: runHostDraft,
});
export async function runHostDraft(
  ctx: MutationCtx,
  args: {
    workspaceId: string;
    principal: typeof hostPrincipal.type;
    commands: (typeof command.type)[];
    draftId?: string;
  },
) {
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
      ...(await log(ctx, args.workspaceId, row.draftId)).map((e) => e.command),
      ...args.commands,
    ],
    results = execute(after, args.commands, args.workspaceId, Date.now(), {
      host: true,
      service: who.kind === "service",
    });
  await replaceDraft(ctx, row, commands, before, after);
  return { draftId: row.draftId, results };
}

export const listDataFrames = internalQuery({
  args: workspace,
  returns: typed<DataFrameRow[]>(v.array(object)),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("dataFrames")
      .withIndex("by_workspaceId_and_id", (q) =>
        q.eq("workspaceId", args.workspaceId),
      )
      .take(1001);
    if (rows.length > 1000) throw new Error("Frame list limit exceeded");
    return rows.map((row) => rowValue(row) as unknown as DataFrameRow);
  },
});
export const removeDataFrame = internalMutation({
  args: { ...workspace, id: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const frame = await find(ctx, args.workspaceId, "dataFrames", args.id);
    if (!frame) return null;
    if (record(frame.storage).type !== "file")
      throw new Error("Only server-owned frames may be removed");
    const tables = await ctx.db
      .query("dataTables")
      .withIndex("by_workspaceId_and_id", (q) =>
        q.eq("workspaceId", args.workspaceId),
      )
      .take(1001);
    if (tables.length > 1000) throw new Error("Table limit exceeded");
    for (const table of tables)
      if (table.dataFrameId === args.id)
        await ctx.db.patch(table._id, {
          dataFrameId: null,
          lastFetchedAt: null,
          revision: table.revision + 1,
          updatedAt: Date.now(),
        });
    await enqueueCleanup(ctx, args.workspaceId, resources(frame).values());
    await ctx.db.delete(frame._id);
    return null;
  },
});
export const clearAllData = internalMutation({
  args: workspace,
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const table of artifactTables) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_workspaceId_and_id", (q) =>
          q.eq("workspaceId", args.workspaceId),
        )
        .take(1001);
      if (rows.length > 1000) throw new Error("Workspace limit exceeded");
      await enqueueCleanup(ctx, args.workspaceId, resources(rows).values());
      for (const row of rows) await ctx.db.delete(row._id);
    }
    const [drafts, draftLog, draftChanges, imports] = await Promise.all([
      ctx.db
        .query("drafts")
        .withIndex("by_workspaceId_and_draftId", (q) =>
          q.eq("workspaceId", args.workspaceId),
        )
        .take(1001),
      ctx.db
        .query("draftLog")
        .withIndex("by_workspaceId_and_draftId_and_sequence", (q) =>
          q.eq("workspaceId", args.workspaceId),
        )
        .take(1001),
      ctx.db
        .query("draftChanges")
        .withIndex("by_workspaceId_and_draftId", (q) =>
          q.eq("workspaceId", args.workspaceId),
        )
        .take(1001),
      ctx.db
        .query("localImports")
        .withIndex("by_workspaceId_and_operationId", (q) =>
          q.eq("workspaceId", args.workspaceId),
        )
        .take(1001),
    ]);
    if (
      [drafts, draftLog, draftChanges, imports].some(
        (rows) => rows.length > 1000,
      )
    )
      throw new Error("Workspace limit exceeded");
    await enqueueCleanup(
      ctx,
      args.workspaceId,
      resources([draftLog, draftChanges]).values(),
    );
    const batches = await ctx.db
      .query("hostBatches")
      .withIndex("by_workspaceId_and_status", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("status", "pending"),
      )
      .take(1001);
    if (batches.length > 1000) throw new Error("Workspace limit exceeded");
    for (const batch of batches) {
      await ctx.db.patch(batch._id, { status: "cancelled", result: null });
      await enqueueCleanup(
        ctx,
        args.workspaceId,
        secretResources(batch.stagedRefs),
      );
    }
    for (const rows of [drafts, draftLog, draftChanges])
      for (const row of rows) await ctx.db.delete(row._id);
    // Keep request tombstones so delayed imports cannot restore cleared data,
    // even if the caller later recreates the same source and table UUIDs.
    for (const row of imports)
      if (!row.cancelled) await ctx.db.patch(row._id, { cancelled: true });
    return null;
  },
});

async function importClaim(
  ctx: QueryCtx,
  workspaceId: string,
  operationId: string,
  requestHash: string,
) {
  if (!operationId || operationId.length > 200)
    throw new Error("Invalid local import operationId");
  if (!/^[0-9a-f]{64}$/i.test(requestHash))
    throw new Error("Local import requestHash must be SHA256");
  const row = await ctx.db
    .query("localImports")
    .withIndex("by_workspaceId_and_operationId", (q) =>
      q.eq("workspaceId", workspaceId).eq("operationId", operationId),
    )
    .unique();
  if (row && row.requestHash !== requestHash)
    throw new Error("Local import operationId reused with different request");
  if (row?.cancelled)
    throw new Error("Local import invalidated by workspace clear");
  return row;
}
const importClaimArgs = {
  ...workspace,
  operationId: v.string(),
  requestHash: v.string(),
};
export const beginLocalImport = internalMutation({
  args: importClaimArgs,
  returns: localImportState,
  handler: async (ctx, args) => {
    const current = await importClaim(
      ctx,
      args.workspaceId,
      args.operationId,
      args.requestHash,
    );
    if (current) {
      const { frameId, fetchedAt, status, result } = current;
      return { frameId, fetchedAt, status, result };
    }
    const state = {
      frameId: crypto.randomUUID(),
      fetchedAt: Date.now(),
      status: "pending" as const,
      result: null,
    };
    await ctx.db.insert("localImports", { ...args, ...state });
    return state;
  },
});
export const getLocalImport = internalQuery({
  args: importClaimArgs,
  returns: v.union(localImportState, v.null()),
  handler: async (ctx, args) => {
    const current = await importClaim(
      ctx,
      args.workspaceId,
      args.operationId,
      args.requestHash,
    );
    if (!current) return null;
    const { frameId, fetchedAt, status, result } = current;
    return { frameId, fetchedAt, status, result };
  },
});
export const cancelLocalImport = internalMutation({
  args: importClaimArgs,
  returns: v.boolean(),
  handler: async (ctx, args) => {
    if (!args.operationId || args.operationId.length > 200)
      throw new Error("Invalid local import operationId");
    if (!/^[0-9a-f]{64}$/i.test(args.requestHash))
      throw new Error("Local import requestHash must be SHA256");
    const current = await ctx.db
      .query("localImports")
      .withIndex("by_workspaceId_and_operationId", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("operationId", args.operationId),
      )
      .unique();
    if (current && current.requestHash !== args.requestHash)
      throw new Error("Local import operationId reused with different request");
    if (!current || current.cancelled || current.status === "complete")
      return false;
    await enqueueCleanup(ctx, args.workspaceId, [
      { kind: "frame", resourceId: current.frameId },
    ]);
    await ctx.db.delete(current._id);
    return true;
  },
});

export { listCleanup, claimCleanup, ackCleanup } from "./cleanup";
export {
  getHostBatch,
  prepareHostBatch,
  executeHostBatch,
  settleHostBatch,
  listPendingHostBatches,
} from "./hostBatches";
