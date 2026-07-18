import {
  schema,
  type HarnessCredentialRecord,
  type HarnessCredentialStore,
} from "@dashframe/server-core";
import type {
  HarnessAccessCredential,
  HarnessConnectionInfo,
  IssuedHarnessAccessCredential,
} from "@dashframe/types";
import { text, uuid } from "@wystack/db";
import { mutation, query, type FunctionContext } from "@wystack/server";

const { projectMeta } = schema;
const PROJECT_META_TABLE = "project_meta";

interface HarnessFunctionContext {
  harnessCredentialStore?: HarnessCredentialStore;
  agentEndpoint?: string;
  callerIdentity?: { kind: "user" | "agent"; id?: string };
}

function context(ctx: unknown): HarnessFunctionContext {
  return ctx as HarnessFunctionContext;
}

function requireStore(ctx: unknown): HarnessCredentialStore {
  const store = context(ctx).harnessCredentialStore;
  if (!store) {
    throw new Error("Harness access is unavailable in this host");
  }
  return store;
}

function requireUserCaller(ctx: unknown): void {
  if (context(ctx).callerIdentity?.kind === "agent") {
    throw new Error("Harness credentials can only be managed in DashFrame");
  }
}

async function project(ctx: FunctionContext) {
  const [row] = await ctx.db.from(projectMeta).all();
  if (!row)
    throw new Error("project_meta row missing — project not initialized");
  return row as { projectId: string; name: string };
}

function toDto(record: HarnessCredentialRecord): HarnessAccessCredential {
  return {
    id: record.id,
    name: record.name,
    tokenPrefix: record.tokenPrefix,
    createdAt: new Date(record.createdAt).getTime(),
    revokedAt: record.revokedAt
      ? new Date(record.revokedAt).getTime()
      : undefined,
  };
}

const getHarnessConnectionInfo = query({
  args: {},
  handler: async (ctx): Promise<HarnessConnectionInfo> => {
    requireUserCaller(ctx);
    requireStore(ctx);
    const meta = await project(ctx);
    const endpoint = context(ctx).agentEndpoint;
    if (!endpoint) throw new Error("Harness endpoint is not ready");
    return {
      projectId: meta.projectId,
      projectName: meta.name,
      endpoint,
      transport: "dashframe-http",
      authentication: "Bearer",
    };
  },
});

const listHarnessAccessCredentials = query({
  args: {},
  handler: async (ctx): Promise<HarnessAccessCredential[]> => {
    requireUserCaller(ctx);
    const store = requireStore(ctx);
    const meta = await project(ctx);
    return (await store.list(meta.projectId)).map(toDto);
  },
});

const issueHarnessAccessCredential = mutation({
  args: { name: text },
  handler: async (
    ctx,
    { name },
  ): Promise<
    IssuedHarnessAccessCredential & { __extraTablesWritten: string[] }
  > => {
    requireUserCaller(ctx);
    const store = requireStore(ctx);
    const meta = await project(ctx);
    const issued = await store.issue(meta.projectId, name);
    return {
      credential: toDto(issued.credential),
      accessCredential: issued.token,
      __extraTablesWritten: [PROJECT_META_TABLE],
    };
  },
});

const revokeHarnessAccessCredential = mutation({
  args: { id: uuid },
  handler: async (
    ctx,
    { id },
  ): Promise<{ ok: true; __extraTablesWritten: string[] }> => {
    requireUserCaller(ctx);
    const store = requireStore(ctx);
    const meta = await project(ctx);
    await store.revoke(meta.projectId, id);
    return { ok: true, __extraTablesWritten: [PROJECT_META_TABLE] };
  },
});

export const harnessAccessFunctions = {
  getHarnessConnectionInfo,
  listHarnessAccessCredentials,
  issueHarnessAccessCredential,
  revokeHarnessAccessCredential,
};
