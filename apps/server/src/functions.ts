/**
 * WyStack function registry — the DashFrame server's RPC surface.
 *
 * Defined once here, consumed two ways (the tRPC pattern):
 *   - runtime: the server app (`createDashframeServer`) mounts these defs.
 *   - type-only: the renderer imports `type { Functions }` for `createWyStack<Functions>`.
 *
 * Handlers read/write artifacts through `ctx.db` — WyStack's DrizzleTracker
 * over the project's PGLite Drizzle instance — so reactive invalidation works.
 */
import { schema } from "@dashframe/server-core";
import { query } from "@wystack/server";

const { projectMeta } = schema;

/** Shape returned by `projectInfo`. Mirrors the persisted `project_meta` row. */
export interface ProjectInfoResult {
  projectId: string;
  name: string;
  version: string;
  schemaVersion: number;
  createdAt: string;
  createdBy: string;
}

/**
 * projectInfo — read the singleton `project_meta` row. No args; one project
 * per database (v0.2 single-project), so the first row is the project.
 */
const projectInfo = query<Record<string, never>, ProjectInfoResult>({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.from(projectMeta).all();
    const meta = rows[0];
    if (!meta) {
      throw new Error("project_meta row missing — project not initialized");
    }
    return {
      projectId: meta.projectId,
      name: meta.name,
      version: meta.version,
      schemaVersion: meta.schemaVersion,
      createdAt: meta.createdAt.toISOString(),
      createdBy: meta.createdBy,
    };
  },
});

/**
 * The registry. Add functions here; the key is the wire path the client calls
 * (`api.projectInfo`). Keep this object the single source of truth for the API.
 */
export const functions = {
  projectInfo,
};

/** Public type surface — what the renderer imports to type its client. */
export type Functions = typeof functions;
