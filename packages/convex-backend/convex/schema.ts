import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { json, object, command } from "./values";
export const artifactFields = {
  workspaceId: v.string(),
  id: v.string(),
  revision: v.number(),
  name: v.string(),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
  kind: v.optional(v.string()),
  storage: v.optional(json),
  config: v.optional(object),
  schema: v.optional(json),
  contentHash: v.optional(v.union(v.string(), v.null())),
  rowCount: v.optional(v.union(v.number(), v.null())),
  lastImport: v.optional(v.union(v.number(), v.null())),
  createdBy: v.optional(object),
  parentArtifactId: v.optional(v.union(v.string(), v.null())),
  dataSourceId: v.optional(v.string()),
  table: v.optional(v.string()),
  sourceSchema: v.optional(json),
  fields: v.optional(v.array(object)),
  metrics: v.optional(v.array(object)),
  dataFrameId: v.optional(v.union(v.string(), v.null())),
  lastFetchedAt: v.optional(v.union(v.number(), v.null())),
  fieldIds: v.optional(v.array(v.string())),
  primaryKey: v.optional(json),
  insightId: v.optional(v.union(v.string(), v.null())),
  sourceId: v.optional(v.union(v.string(), v.null())),
  definitionId: v.optional(v.union(v.string(), v.null())),
  columnCount: v.optional(v.union(v.number(), v.null())),
  analysis: v.optional(json),
  lastRefreshedAt: v.optional(v.union(v.number(), v.null())),
  definition: v.optional(object),
  chartType: v.optional(v.string()),
  encoding: v.optional(json),
  options: v.optional(object),
  layout: v.optional(v.array(object)),
  description: v.optional(v.union(v.string(), v.null())),
  controls: v.optional(json),
};
export const artifact = v.object(artifactFields);
export const localImportResult = v.object({
  dataFrameId: v.string(),
  rowCount: v.number(),
  columnCount: v.number(),
  fetchedAt: v.number(),
});
export const localImportState = v.object({
  frameId: v.string(),
  fetchedAt: v.number(),
  status: v.union(v.literal("pending"), v.literal("complete")),
  result: v.union(localImportResult, v.null()),
});
const artifactTable = () =>
  defineTable(artifactFields)
    .index("by_workspaceId_and_id", ["workspaceId", "id"])
    .index("by_workspaceId_and_dataSourceId", ["workspaceId", "dataSourceId"])
    .index("by_workspaceId_and_insightId", ["workspaceId", "insightId"])
    .index("by_workspaceId_and_kind", ["workspaceId", "kind"]);
export default defineSchema({
  workspaces: defineTable({
    workspaceId: v.string(),
    projectId: v.string(),
    name: v.string(),
    version: v.string(),
    schemaVersion: v.number(),
    createdAt: v.number(),
    createdBy: v.string(),
  }).index("by_workspaceId", ["workspaceId"]),
  dataSources: artifactTable(),
  dataTables: artifactTable(),
  dataFrames: artifactTable(),
  insights: artifactTable(),
  visualizations: artifactTable(),
  dashboards: artifactTable(),
  drafts: defineTable({
    workspaceId: v.string(),
    draftId: v.string(),
    owner: v.string(),
    revision: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    commandCount: v.number(),
  })
    .index("by_workspaceId_and_draftId", ["workspaceId", "draftId"])
    .index("by_workspaceId_and_owner", ["workspaceId", "owner"]),
  draftLog: defineTable({
    workspaceId: v.string(),
    draftId: v.string(),
    sequence: v.number(),
    command,
  }).index("by_workspaceId_and_draftId_and_sequence", [
    "workspaceId",
    "draftId",
    "sequence",
  ]),
  draftChanges: defineTable({
    workspaceId: v.string(),
    draftId: v.string(),
    table: v.string(),
    id: v.string(),
    base: v.union(artifact, v.null()),
    value: v.union(artifact, v.null()),
  }).index("by_workspaceId_and_draftId", ["workspaceId", "draftId"]),
  revokedCredentials: defineTable({
    workspaceId: v.string(),
    credentialId: v.string(),
  }).index("by_workspaceId_and_credentialId", ["workspaceId", "credentialId"]),
  connectorSetupSessions: defineTable({
    workspaceId: v.string(),
    id: v.string(),
    stateNonceHash: v.string(),
    state: v.string(),
    updatedAt: v.number(),
    value: object,
  })
    .index("by_workspaceId_and_id", ["workspaceId", "id"])
    .index("by_workspaceId_and_stateNonceHash", [
      "workspaceId",
      "stateNonceHash",
    ])
    .index("by_workspaceId", ["workspaceId"]),
  hostSettings: defineTable({
    workspaceId: v.string(),
    kind: v.string(),
    id: v.string(),
    value: object,
  }).index("by_workspaceId_and_kind_and_id", ["workspaceId", "kind", "id"]),
  localImports: defineTable({
    workspaceId: v.string(),
    operationId: v.string(),
    requestHash: v.string(),
    ...localImportState.fields,
  }).index("by_workspaceId_and_operationId", ["workspaceId", "operationId"]),
  operations: defineTable({
    workspaceId: v.string(),
    operationId: v.string(),
    request: json,
    result: json,
  }).index("by_workspaceId_and_operationId", ["workspaceId", "operationId"]),
});
