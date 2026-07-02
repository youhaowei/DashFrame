import {
  createAssistantRun,
  type CreateAssistantRunOptions,
} from "@dashframe/assistant";
import { openArtifactDb } from "@dashframe/server-core";
import type { UUID } from "@dashframe/types";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildDashframeApp, createDraftController } from "./app";
import { createDashframeAssistantHost } from "./assistant-host";

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

const model: CreateAssistantRunOptions["model"] = {
  id: "dashframe-test-model",
  name: "DashFrame Test Model",
  api: "anthropic-messages",
  provider: "anthropic",
  baseUrl: "http://localhost",
  reasoning: false,
  input: ["text"],
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  contextWindow: 100_000,
  maxTokens: 8_192,
};

function assistantMessage(content: unknown[], stopReason: "toolUse" | "stop") {
  return {
    role: "assistant" as const,
    content,
    api: "anthropic-messages" as const,
    provider: "anthropic" as const,
    model: model.id,
    usage,
    stopReason,
    timestamp: Date.now(),
  };
}

function call(id: string, name: string, args: Record<string, unknown>) {
  return { type: "toolCall" as const, id, name, arguments: args };
}

function scriptedStream(messages: ReturnType<typeof assistantMessage>[]) {
  let index = 0;
  const streamFn = () => {
    const message = messages[index++];
    if (message === undefined) {
      throw new Error("test stream exhausted");
    }
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: "start" as const, partial: message };
        yield {
          type: "done" as const,
          reason:
            message.stopReason === "toolUse"
              ? ("toolUse" as const)
              : ("stop" as const),
          message,
        };
      },
      result: async () => message,
    };
  };
  return streamFn as unknown as NonNullable<
    CreateAssistantRunOptions["streamFn"]
  >;
}

describe("DashFrame AssistantHost integration", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: Awaited<ReturnType<typeof buildDashframeApp>>;
  let draftController: ReturnType<typeof createDraftController>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-assistant-host-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    // Mirror createDashframeServer's serverContext composition: the host's
    // discard routes through app.call("discardDraft"), whose handler requires
    // ctx.draftController (and reads ctx.artifactDb for credential release).
    const serverContext: Record<string, unknown> = {};
    const rawApp = await buildDashframeApp({ db });
    app = {
      ...rawApp,
      call: (path, args, context) =>
        rawApp.call(path, args, { ...(context ?? {}), ...serverContext }),
    };
    draftController = createDraftController(app, db);
    serverContext.draftController = draftController;
    serverContext.artifactDb = db;
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("binds the single host port through a full run lifecycle", async () => {
    const dashboardId = crypto.randomUUID() as UUID;
    const host = createDashframeAssistantHost({ app, draftController });
    const firstMutations: string[] = [];
    const toolErrors: boolean[] = [];

    const result = await createAssistantRun(host, {
      model,
      prompt: "Create a dashboard, recover if needed.",
      streamFn: scriptedStream([
        assistantMessage(
          [
            call("bad-command", "applyCommand", {
              type: "DeleteNode",
              args: { id: dashboardId },
            }),
          ],
          "toolUse",
        ),
        assistantMessage(
          [
            call("create-dashboard", "applyCommand", {
              type: "CreateDashboard",
              args: { id: dashboardId, name: "Recovered" },
            }),
            call("rename-dashboard", "applyCommand", {
              type: "RenameNode",
              args: { id: dashboardId, name: "Recovered Overview" },
            }),
          ],
          "toolUse",
        ),
        assistantMessage(
          [{ type: "text", text: "Stopped at a review boundary." }],
          "stop",
        ),
      ]),
      onFirstMutation: ({ draftId }) => {
        firstMutations.push(draftId);
      },
      onEvent: (event) => {
        if (event.type === "tool_execution_end") {
          toolErrors.push(event.isError);
        }
      },
    });

    expect(firstMutations).toEqual([result.draftId]);
    expect(result.firstMutationObserved).toBe(true);
    expect(toolErrors).toEqual([true, false, false]);
    expect(result.messages.at(-1)?.role).toBe("assistant");

    const log = await draftController.getDraftLog(result.draftId);
    expect(log.map((entry) => entry.path)).toEqual([
      "createDashboardCmd",
      "renameNode",
    ]);

    await result.discard();

    expect(await draftController.getDraftLog(result.draftId)).toEqual([]);
    const canonical = await app.runHandler(
      "getDashboard",
      { id: dashboardId },
      app.createTracked(),
      {},
    );
    expect(canonical).toBeNull();
  });
});
