import { expect, it } from "vitest";
import { convexTest } from "convex-test";
import {
  makeFunctionReference,
  type FunctionArgs,
  type FunctionReference,
} from "convex/server";
import * as app from "../convex/app";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
type MutationName = {
  [K in keyof typeof api.app]: (typeof api.app)[K] extends FunctionReference<"mutation">
    ? K
    : never;
}[keyof typeof api.app];
const draftId = "00000000-0000-4000-8000-000000000001";
const cases = {
  commitBatch: { args: { commands: [] } },
  draftBatch: {
    args: { commands: [] },
    openToService: "Services may propose changes in their own drafts.",
  },
  discardDraft: {
    args: { draftId },
    openToService:
      "Draft ownership permits services to discard only their own drafts.",
  },
  publishDraft: { args: { draftId } },
  reviseDraft: { args: { draftId, expectedLogSignature: "missing", ops: [] } },
  updateDataFrameEntry: { args: { id: draftId, updates: {} } },
} satisfies {
  [K in MutationName]: {
    args: FunctionArgs<(typeof api.app)[K]>;
    openToService?: string;
  };
};

const mutations = Object.entries(app)
  .filter(([, fn]) => "isMutation" in fn && fn.isMutation === true)
  .map(([name]) => name);

it("classifies every registered public mutation, with no stale entries", () => {
  expect(mutations.sort()).toEqual(Object.keys(cases).sort());
});

for (const [name, entry] of Object.entries(cases)) {
  if ("openToService" in entry) continue;
  it(`${name} rejects services with User permission required and admits users past that guard`, async () => {
    const t = convexTest(schema, modules);
    const service = () =>
      t.withIdentity({
        subject: "bot",
        workspaceId: "w",
        principalKind: "service",
        credentialId: "bot",
      });
    const user = () =>
      t.withIdentity({
        subject: "u",
        workspaceId: "w",
        principalKind: "user",
        userId: "u",
      });
    const ref = makeFunctionReference<"mutation">(`app:${name}`);
    await expect(service().mutation(ref, entry.args)).rejects.toThrow(
      "User permission required",
    );
    const message = await user()
      .mutation(ref, entry.args)
      .then(
        () => "",
        (error: unknown) =>
          error instanceof Error ? error.message : String(error),
      );
    expect(message).not.toContain("User permission required");
  });
}

it("allows service drafting and own-draft discard, but rejects another service's discard", async () => {
  const t = convexTest(schema, modules);
  const service = (credentialId: string) =>
    t.withIdentity({
      subject: credentialId,
      workspaceId: "w",
      principalKind: "service",
      credentialId,
    });
  const { draftId } = await service("bot").mutation(
    api.app.draftBatch,
    cases.draftBatch.args,
  );
  await expect(
    service("other").mutation(api.app.discardDraft, { draftId }),
  ).rejects.toThrow("Draft unavailable");
  await expect(
    service("bot").mutation(api.app.discardDraft, { draftId }),
  ).resolves.toBeNull();
  const owned = await t
    .withIdentity({
      subject: "u",
      workspaceId: "w",
      principalKind: "user",
      userId: "u",
    })
    .mutation(api.app.draftBatch, cases.draftBatch.args);
  await expect(
    service("bot").mutation(api.app.discardDraft, { draftId: owned.draftId }),
  ).rejects.toThrow("Draft unavailable");
});
