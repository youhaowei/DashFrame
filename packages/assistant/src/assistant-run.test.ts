import type { AgentEvent, StreamFn } from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type Model,
  type ToolCall,
  type Usage,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import type {
  AssistantCommand,
  AssistantCommandResult,
  AssistantHost,
} from "./assistant-host.js";
import { createAssistantRun } from "./assistant-run.js";
import type { GraphReader } from "./read/port.js";

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

function emptyReader(): GraphReader {
  const missing = async () => null;
  const empty = async () => [];
  return {
    getDataSource: missing,
    getDataTable: missing,
    getDataFrameEntry: missing,
    getInsight: missing,
    getVisualization: missing,
    getDashboard: missing,
    listDataSources: empty,
    listDataTables: empty,
    listDataFrames: empty,
    listInsights: empty,
    listVisualizations: empty,
    listDashboards: empty,
    getDataFrameByInsight: missing,
    readDataProfile: missing,
    readSource: missing,
  };
}

function makeHost(): AssistantHost & {
  opened: number;
  discarded: string[];
  appends: Array<{ draftId: string; batch: AssistantCommand[] }>;
} {
  return {
    opened: 0,
    discarded: [],
    appends: [],
    async open() {
      this.opened += 1;
      return "draft-run";
    },
    async append(draftId, batch) {
      this.appends.push({ draftId, batch });
      return batch.map(
        (command): AssistantCommandResult => ({
          id: command.id,
          value: { path: command.path },
        }),
      );
    },
    async discard(draftId) {
      this.discarded.push(draftId);
    },
    buildCommand(type, args) {
      if (type === "Unknown") throw new Error(`Unknown command: "${type}"`);
      return { path: `${type}Path`, args };
    },
    reader: emptyReader,
  };
}

describe("createAssistantRun", () => {
  it("eager-mints a draft but lazy-surfaces only after first successful mutation", async () => {
    const host = makeHost();
    const firstMutations: string[] = [];

    const result = await createAssistantRun(host, {
      model,
      prompt: "Inspect only.",
      streamFn: scriptedStream([
        assistantMessage(
          [{ type: "text", text: "No draft edits needed." }],
          "stop",
        ),
      ]),
      onFirstMutation: ({ draftId }) => {
        firstMutations.push(draftId);
      },
    });

    expect(host.opened).toBe(1);
    expect(result.draftId).toBe("draft-run");
    expect(result.firstMutationObserved).toBe(false);
    expect(firstMutations).toEqual([]);
    expect(host.appends).toEqual([]);
  });

  it("signals the first successful applyCommand exactly once", async () => {
    const host = makeHost();
    const firstMutations: string[] = [];

    const result = await createAssistantRun(host, {
      model,
      prompt: "Create and rename.",
      streamFn: scriptedStream([
        assistantMessage(
          [
            call("create-dashboard", "applyCommand", {
              type: "CreateDashboard",
              args: { id: "dashboard-1", name: "Executive" },
            }),
            call("rename-dashboard", "applyCommand", {
              type: "RenameNode",
              args: { id: "dashboard-1", name: "Executive Overview" },
            }),
          ],
          "toolUse",
        ),
        assistantMessage(
          [{ type: "text", text: "Draft is ready for review." }],
          "stop",
        ),
      ]),
      onFirstMutation: ({ draftId }) => {
        firstMutations.push(draftId);
      },
    });

    expect(result.firstMutationObserved).toBe(true);
    expect(firstMutations).toEqual(["draft-run"]);
    expect(host.appends.map((append) => append.batch[0]?.path)).toEqual([
      "CreateDashboardPath",
      "RenameNodePath",
    ]);
  });

  it("round-trips tool errors as isError and pi continues to the coherent boundary", async () => {
    const host = makeHost();
    const events: AgentEvent[] = [];

    const result = await createAssistantRun(host, {
      model,
      prompt: "Recover from an unsafe command.",
      streamFn: scriptedStream([
        assistantMessage(
          [
            call("bad-command", "applyCommand", {
              type: "DeleteNode",
              args: { id: "dashboard-1" },
            }),
          ],
          "toolUse",
        ),
        assistantMessage(
          [
            call("fixed-command", "applyCommand", {
              type: "CreateDashboard",
              args: { id: "dashboard-1", name: "Recovered" },
            }),
          ],
          "toolUse",
        ),
        assistantMessage(
          [{ type: "text", text: "Stopped at a review boundary." }],
          "stop",
        ),
      ]),
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
    expect(host.appends.map((append) => append.batch[0]?.path)).toEqual([
      "CreateDashboardPath",
    ]);
  });

  it("returns a discard handle over the same host port", async () => {
    const host = makeHost();

    const result = await createAssistantRun(host, {
      model,
      prompt: "Create a draft.",
      streamFn: scriptedStream([
        assistantMessage(
          [
            call("create-dashboard", "applyCommand", {
              type: "CreateDashboard",
              args: { id: "dashboard-1", name: "Discard Me" },
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

    await result.discard();

    expect(host.discarded).toEqual(["draft-run"]);
  });
});
