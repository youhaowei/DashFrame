import { beforeEach, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { cmd } from "@dashframe/types";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.ts");
const makeTest = () => convexTest(schema, modules);
const workspaceId = "credential-guards";
const userPrincipal = { kind: "user" as const, userId: "user" };
const servicePrincipal = {
  kind: "service" as const,
  credentialId: "connector-wiring-agent",
};

let t: ReturnType<typeof makeTest>;

beforeEach(() => {
  t = makeTest();
});

const user = () =>
  t.withIdentity({
    subject: "user",
    workspaceId,
    principalKind: "user",
    userId: "user",
  });

const secret = () => `secret:${crypto.randomUUID()}`;

async function createCredentialedSource(kind = "notion") {
  const sourceId = crypto.randomUUID();
  const ref = secret();
  await t.mutation(internal.host.commitBatch, {
    workspaceId,
    principal: userPrincipal,
    commands: [
      {
        path: "createDataSource",
        args: {
          id: sourceId,
          name: "Credentialed source",
          type: kind,
          apiKey: ref,
          ...(kind === "rest"
            ? { extra: { endpoint: "https://trusted.example/data" } }
            : {}),
        },
      },
    ],
  });
  return { sourceId, ref };
}

async function source(sourceId: string) {
  return t.query(internal.host.getDataSource, {
    workspaceId,
    id: sourceId,
  });
}

async function sourceRevision(sourceId: string) {
  return t.run(async (ctx) => {
    const row = await ctx.db
      .query("dataSources")
      .withIndex("by_workspaceId_and_id", (q) =>
        q.eq("workspaceId", workspaceId).eq("id", sourceId),
      )
      .unique();
    return row?.revision;
  });
}

async function cleanupRefs() {
  const result = await t.query(internal.host.listCleanup, {
    workspaceId,
    paginationOpts: { cursor: null, numItems: 100 },
  });
  return result.page.map((job) => job.resourceId);
}

it("refuses public empty-string credential deletion without reaping the secret, while allowing the host path", async () => {
  const { sourceId, ref } = await createCredentialedSource();

  await expect(
    user().mutation(api.app.commitBatch, {
      commands: [
        cmd("SetDataSourceConfig", {
          id: sourceId,
          apiKey: "",
        }),
      ],
    }),
  ).rejects.toThrow("host");

  expect((await source(sourceId))?.config.apiKey).toBe(ref);
  expect(await cleanupRefs()).not.toContain(ref);

  await t.mutation(internal.host.commitBatch, {
    workspaceId,
    principal: userPrincipal,
    commands: [
      {
        path: "setDataSourceConfig",
        args: { id: sourceId, apiKey: "" },
      },
    ],
  });

  expect((await source(sourceId))?.config.apiKey).toBeUndefined();
  expect(await cleanupRefs()).toContain(ref);
});

it("fails when a service wires a new connector destination without re-affirming its inherited credential", async () => {
  const { sourceId, ref } = await createCredentialedSource("rest");

  await expect(
    t.mutation(internal.host.draftBatch, {
      workspaceId,
      principal: servicePrincipal,
      commands: [
        {
          path: "setDataSourceConfig",
          args: {
            id: sourceId,
            extra: { endpoint: "https://attacker.example/collect" },
          },
        },
      ],
    }),
  ).rejects.toThrow("inherited credential");

  expect(await source(sourceId)).toMatchObject({
    config: {
      apiKey: ref,
      endpoint: "https://trusted.example/data",
    },
  });
});

it("refuses a public draft redirect of a persisted credentialed source", async () => {
  const { sourceId, ref } = await createCredentialedSource("rest");

  await expect(
    user().mutation(api.app.draftBatch, {
      commands: [
        cmd("SetDataSourceConfig", {
          id: sourceId,
          extra: { endpoint: "https://attacker.example/collect" },
        }),
      ],
    }),
  ).rejects.toThrow("inherited credential");

  expect(await sourceRevision(sourceId)).toBe(1);
  expect(await source(sourceId)).toMatchObject({
    config: {
      apiKey: ref,
      endpoint: "https://trusted.example/data",
    },
  });
});

it("refuses a later draft redirect after a credentialed source is published from an earlier draft", async () => {
  const sourceId = crypto.randomUUID();
  const ref = secret();
  const created = await t.mutation(internal.host.draftBatch, {
    workspaceId,
    principal: userPrincipal,
    commands: [
      {
        path: "createDataSource",
        args: {
          id: sourceId,
          name: "Draft REST source",
          type: "rest",
          apiKey: ref,
          extra: { endpoint: "https://trusted.example/data" },
        },
      },
    ],
  });
  await user().mutation(api.app.publishDraft, { draftId: created.draftId });

  expect(await sourceRevision(sourceId)).toBe(1);
  await expect(
    user().mutation(api.app.draftBatch, {
      commands: [
        cmd("SetDataSourceConfig", {
          id: sourceId,
          extra: { endpoint: "https://attacker.example/collect" },
        }),
      ],
    }),
  ).rejects.toThrow("inherited credential");

  expect(await source(sourceId)).toMatchObject({
    config: {
      apiKey: ref,
      endpoint: "https://trusted.example/data",
    },
  });
});

it("allows Postgres onboarding to create a credentialed source and set its default schema in one batch", async () => {
  const sourceId = crypto.randomUUID();
  const ref = secret();

  await t.mutation(internal.host.commitBatch, {
    workspaceId,
    principal: userPrincipal,
    commands: [
      {
        path: "createDataSource",
        args: {
          id: sourceId,
          name: "Postgres",
          type: "postgres",
          connectionString: ref,
        },
      },
      {
        path: "setDataSourceConfig",
        args: {
          id: sourceId,
          extra: { defaultSchema: "reporting" },
        },
      },
    ],
  });

  expect(await source(sourceId)).toMatchObject({
    kind: "postgres",
    config: {
      connectionString: ref,
      defaultSchema: "reporting",
    },
  });
});
