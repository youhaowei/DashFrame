import { describe, expect, it, vi } from "vite-plus/test";
import type { HostContext } from "./context";
import {
  HostBatchRejectedError,
  HostBatchOutcomeUnknownError,
} from "./commands";
import { persistVerifiedSource } from "./verified-source";

const source = {
  id: crypto.randomUUID(),
  type: "googleAnalytics",
  name: "Analytics",
  apiKey: "test-token-bundle",
};
function setup(error?: Error, existing: unknown = null, queryError = false) {
  const execute = vi.fn(async () => {
    if (error) throw error;
  });
  const getDataSource = vi.fn(async () => {
    if (queryError) throw new Error("offline");
    return existing;
  });
  const ctx = {
    principal: { kind: "user", userId: "local-user" },
    application: { execute },
    metadata: { getDataSource },
  } as unknown as HostContext;
  return { ctx, execute, getDataSource };
}

describe("verified OAuth source publication", () => {
  it("uses the reserved source ID as its stable command operation ID", async () => {
    const { ctx, execute } = setup();
    await expect(persistVerifiedSource(ctx, source)).resolves.toBe(true);
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      "createDataSource",
      source,
      {
        principal: ctx.principal,
        operationId: source.id,
      },
    );
  });
  it("confirms the reserved source after a committed response is lost", async () => {
    const { ctx } = setup(new Error("response lost"), {
      id: source.id,
      kind: source.type,
    });
    await expect(persistVerifiedSource(ctx, source)).resolves.toBe(true);
  });
  it.each([false, true])(
    "keeps unconfirmed publication recoverable (query unavailable: %s)",
    async (queryError) => {
      const { ctx } = setup(
        new HostBatchOutcomeUnknownError(source.id),
        null,
        queryError,
      );
      await expect(persistVerifiedSource(ctx, source)).resolves.toBe(false);
    },
  );
  it("reports failure only after the command was fenced against late commit", async () => {
    const error = new HostBatchRejectedError(new Error("invalid source"));
    const { ctx } = setup(error);
    await expect(persistVerifiedSource(ctx, source)).rejects.toBe(error);
  });
});
