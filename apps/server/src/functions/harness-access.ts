import type {
  HarnessCredentialRecord,
  HarnessCredentialStore,
} from "@dashframe/server-core";
import type {
  HarnessAccessCredential,
  HarnessConnectionInfo,
  IssuedHarnessAccessCredential,
} from "@dashframe/types";
import { text, uuid } from "@wystack/db";
import { mutation, query } from "@wystack/server";

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
    const endpoint = context(ctx).agentEndpoint;
    if (!endpoint) throw new Error("Harness endpoint is not ready");
    return {
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
    return (await store.list()).map(toDto);
  },
});

const issueHarnessAccessCredential = mutation({
  args: { name: text },
  handler: async (ctx, { name }): Promise<IssuedHarnessAccessCredential> => {
    requireUserCaller(ctx);
    const store = requireStore(ctx);
    const issued = await store.issue(name);
    return {
      credential: toDto(issued.credential),
      accessCredential: issued.token,
    };
  },
});

const revokeHarnessAccessCredential = mutation({
  args: { id: uuid },
  handler: async (ctx, { id }): Promise<{ ok: true }> => {
    requireUserCaller(ctx);
    const store = requireStore(ctx);
    await store.revoke(id);
    return { ok: true };
  },
});

export const harnessAccessFunctions = {
  getHarnessConnectionInfo,
  listHarnessAccessCredentials,
  issueHarnessAccessCredential,
  revokeHarnessAccessCredential,
};
