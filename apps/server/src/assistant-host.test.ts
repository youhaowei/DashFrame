import {
  createAssistantRun,
  type CreateAssistantRunOptions,
} from "@dashframe/assistant";
import { cmd, type Command, type UUID } from "@dashframe/types";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createDashframeAssistantHost } from "./assistant-host";
import type { ApplicationOperations } from "./host/application";
import { LOCAL_USER_ID } from "./permissions";

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

describe("DashFrame AssistantHost ApplicationOperations integration", () => {
  const principal = { kind: "user" as const, userId: LOCAL_USER_ID };
  const draftId = "assistant-draft";
  let execute: ReturnType<typeof vi.fn<ApplicationOperations["execute"]>>;
  let forPrincipal: ReturnType<
    typeof vi.fn<ApplicationOperations["forPrincipal"]>
  >;
  let app: ApplicationOperations;

  beforeEach(() => {
    execute = vi.fn<ApplicationOperations["execute"]>(
      async (operation, input) => {
        if (operation === "discardDraft") return null;
        if (operation === "getDashboard") return null;
        if (operation !== "draftBatch")
          throw new Error(`Unexpected operation: ${operation}`);
        const { commands } = input as { commands: Command[] };
        if (commands.some((command) => command.path === "deleteNode"))
          throw new Error("Node not found");
        return {
          draftId,
          results: commands.map((command) => ({ value: command.args })),
        };
      },
    );
    forPrincipal = vi.fn(() => app);
    app = { execute, forPrincipal };
  });

  it("binds the single host port through a full run lifecycle", async () => {
    const dashboardId = crypto.randomUUID() as UUID;
    const host = createDashframeAssistantHost({
      app,
      principal,
    });
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

    const draftCalls = execute.mock.calls.filter(
      ([operation]) => operation === "draftBatch",
    );
    expect(draftCalls).toEqual([
      ["draftBatch", { commands: [] }, { principal }],
      [
        "draftBatch",
        {
          draftId,
          commands: [
            cmd("CreateDashboard", { id: dashboardId, name: "Recovered" }),
          ],
        },
        { principal },
      ],
      [
        "draftBatch",
        {
          draftId,
          commands: [
            cmd("RenameNode", { id: dashboardId, name: "Recovered Overview" }),
          ],
        },
        { principal },
      ],
    ]);
    await result.discard();
    expect(execute).toHaveBeenLastCalledWith(
      "discardDraft",
      { draftId },
      { principal },
    );
    // The host exposes only draft writes; a successful run never commits canonical state.
    expect(
      execute.mock.calls.some(
        ([operation]) =>
          operation === "commitBatch" || operation === "publishDraft",
      ),
    ).toBe(false);
  });

  it("forwards a service principal into draft append dispatch", async () => {
    const host = createDashframeAssistantHost({
      app,
      principal: { kind: "service", credentialId: "credential-1" },
    });
    const draftId = await host.open();
    const dashboardId = crypto.randomUUID();

    await host.append(
      draftId,
      [cmd("CreateDashboard", { id: dashboardId, name: "Service draft" })],
      {},
    );

    expect(execute).toHaveBeenLastCalledWith(
      "draftBatch",
      {
        draftId,
        commands: [
          cmd("CreateDashboard", { id: dashboardId, name: "Service draft" }),
        ],
      },
      { principal: { kind: "service", credentialId: "credential-1" } },
    );
  });

  it("propagates a rejected batch once without retrying or splitting its commands", async () => {
    const rejected = new Error("Native transaction rejected");
    execute.mockRejectedValueOnce(rejected);
    const host = createDashframeAssistantHost({ app, principal });
    const commands = [
      cmd("CreateDashboard", { id: crypto.randomUUID(), name: "Atomic draft" }),
      cmd("DeleteNode", { id: crypto.randomUUID() }),
    ];
    await expect(host.append(draftId, commands)).rejects.toBe(rejected);
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      "draftBatch",
      { draftId, commands },
      { principal },
    );
  });

  it("binds reads to the supplied principal and draft without leaking that context into arguments", async () => {
    const scopedExecute = vi
      .fn<ApplicationOperations["execute"]>()
      .mockResolvedValue({ id: "dashboard-1", name: "Draft dashboard" });
    const scoped: ApplicationOperations = {
      execute: scopedExecute,
      forPrincipal: () => scoped,
    };
    forPrincipal.mockReturnValue(scoped);
    const service = { kind: "service" as const, credentialId: "credential-1" };
    const host = createDashframeAssistantHost({ app, principal: service });
    const reader = host.reader(draftId);
    await expect(reader.getDashboard("dashboard-1")).resolves.toEqual({
      id: "dashboard-1",
      name: "Draft dashboard",
    });
    expect(forPrincipal).toHaveBeenCalledExactlyOnceWith(service);
    expect(scopedExecute).toHaveBeenCalledExactlyOnceWith(
      "getDashboard",
      { id: "dashboard-1" },
      { draftId },
    );
    expect(execute).not.toHaveBeenCalled();
  });
});
