import { openArtifactDb } from "@dashframe/server-core";
import type { UUID } from "@dashframe/types";
import type { AgentEvent, StreamFn } from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type Model,
  type ToolCall,
  type Usage,
} from "@earendil-works/pi-ai";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildDashframeApp, createDraftController } from "./app";
import { createPiAgentRunController } from "./pi-agent-run-controller";

const usage: Usage = {
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

const model: Model<Api> = {
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

function assistantMessage(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "anthropic-messages",
    provider: "anthropic",
    model: model.id,
    usage,
    stopReason,
    timestamp: Date.now(),
  };
}

function call(
  id: string,
  name: string,
  args: Record<string, unknown>,
): ToolCall {
  return { type: "toolCall", id, name, arguments: args };
}

function scriptedStream(messages: AssistantMessage[]): StreamFn {
  let index = 0;
  return () => {
    const stream = createAssistantMessageEventStream();
    const message = messages[index++];
    if (message === undefined) {
      throw new Error("test stream exhausted");
    }
    queueMicrotask(() => {
      stream.push({ type: "start", partial: message });
      stream.push({
        type: "done",
        reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
        message,
      });
    });
    return stream;
  };
}

describe("pi-agent run controller", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: Awaited<ReturnType<typeof buildDashframeApp>>;
  let draftController: ReturnType<typeof createDraftController>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-pi-run-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    app = await buildDashframeApp({ db });
    draftController = createDraftController(app, db);
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("eager-mints a draft and does not surface it when the run makes no mutation", async () => {
    const runController = createPiAgentRunController({
      app,
      draftController,
      model,
      streamFn: scriptedStream([
        assistantMessage(
          [{ type: "text", text: "No draft edits needed." }],
          "stop",
        ),
      ]),
    });

    const firstMutations: string[] = [];
    const result = await runController.start({
      prompt: "Inspect only.",
      onFirstMutation: ({ draftId }) => {
        firstMutations.push(draftId);
      },
    });

    expect(result.draftId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(firstMutations).toEqual([]);
    expect(result.firstMutationObserved).toBe(false);
    expect(await draftController.getDraftLog(result.draftId)).toEqual([]);
  });

  it("fires the first successful applyCommand signal exactly once", async () => {
    const dashboardId = crypto.randomUUID() as UUID;
    const runController = createPiAgentRunController({
      app,
      draftController,
      model,
      streamFn: scriptedStream([
        assistantMessage(
          [
            call("create-dashboard", "applyCommand", {
              type: "CreateDashboard",
              args: { id: dashboardId, name: "Executive" },
            }),
            call("rename-dashboard", "applyCommand", {
              type: "RenameNode",
              args: { id: dashboardId, name: "Executive Overview" },
            }),
          ],
          "toolUse",
        ),
        assistantMessage(
          [{ type: "text", text: "Draft is ready for review." }],
          "stop",
        ),
      ]),
    });

    const firstMutations: string[] = [];
    const result = await runController.start({
      prompt: "Create a dashboard.",
      onFirstMutation: ({ draftId }) => {
        firstMutations.push(draftId);
      },
    });

    expect(firstMutations).toEqual([result.draftId]);
    expect(result.firstMutationObserved).toBe(true);
    const log = await draftController.getDraftLog(result.draftId);
    expect(log.map((entry) => entry.path)).toEqual([
      "createDashboardCmd",
      "renameNode",
    ]);
  });

  it("round-trips applyCommand failures as isError tool results and lets pi continue", async () => {
    const dashboardId = crypto.randomUUID() as UUID;
    const events: AgentEvent[] = [];
    const runController = createPiAgentRunController({
      app,
      draftController,
      model,
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
            call("fixed-command", "applyCommand", {
              type: "CreateDashboard",
              args: { id: dashboardId, name: "Recovered" },
            }),
          ],
          "toolUse",
        ),
        assistantMessage(
          [
            {
              type: "text",
              text: "Recovered and stopped at a review boundary.",
            },
          ],
          "stop",
        ),
      ]),
    });

    const result = await runController.start({
      prompt: "Create a dashboard, recover if needed.",
      onEvent: (event) => {
        events.push(event);
      },
    });

    const toolEnds = events.filter(
      (event): event is Extract<AgentEvent, { type: "tool_execution_end" }> =>
        event.type === "tool_execution_end",
    );
    expect(toolEnds.map((event) => event.isError)).toEqual([true, false]);
    expect(result.messages.at(-1)?.role).toBe("assistant");
    const log = await draftController.getDraftLog(result.draftId);
    expect(log.map((entry) => entry.path)).toEqual(["createDashboardCmd"]);
  });

  it("returns a discard handle for the human-gated draft lifecycle", async () => {
    const dashboardId = crypto.randomUUID() as UUID;
    const runController = createPiAgentRunController({
      app,
      draftController,
      model,
      streamFn: scriptedStream([
        assistantMessage(
          [
            call("create-dashboard", "applyCommand", {
              type: "CreateDashboard",
              args: { id: dashboardId, name: "Discard Me" },
            }),
          ],
          "toolUse",
        ),
        assistantMessage(
          [{ type: "text", text: "Ready for human decision." }],
          "stop",
        ),
      ]),
    });

    const result = await runController.start({
      prompt: "Create a dashboard draft.",
    });
    expect(await draftController.getDraftLog(result.draftId)).toHaveLength(1);

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
