import { describe, expect, it, vi } from "vitest";

import { createApplyCommandTool } from "./apply-command-tool.js";
import type { AssistantCommand, AssistantHost } from "./assistant-host.js";
import type { GraphReader } from "./read/port.js";

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

function makeHost(overrides?: {
  appendResult?: Array<{ id?: string; value: unknown }>;
  appendError?: Error;
  buildCommand?: (type: string, args: unknown) => AssistantCommand;
}): AssistantHost & {
  appendCalls: Array<{
    draftId: string;
    batch: AssistantCommand[];
    context?: Record<string, unknown>;
  }>;
} {
  const appendCalls: Array<{
    draftId: string;
    batch: AssistantCommand[];
    context?: Record<string, unknown>;
  }> = [];

  return {
    appendCalls,
    open: async () => "draft-id",
    async append(draftId, batch, context) {
      appendCalls.push({ draftId, batch, context });
      if (overrides?.appendError) throw overrides.appendError;
      return overrides?.appendResult ?? [{ value: { ok: true } }];
    },
    discard: async () => {},
    buildCommand:
      overrides?.buildCommand ??
      ((type, args) => ({ path: `${type}Path`, args })),
    reader: emptyReader,
  };
}

describe("createApplyCommandTool — internal AssistantHost tool", () => {
  it("builds through the host, appends exactly one command, and forwards context", async () => {
    const host = makeHost({
      appendResult: [{ value: { id: "dashboard-1" } }],
    });
    const tool = createApplyCommandTool({
      host,
      draftId: "draft-abc",
      context: { sessionId: "session-1" },
    });

    const result = await tool.execute("call-1", {
      type: "CreateDashboard",
      args: { id: "dashboard-1", name: "Executive" },
    });

    expect(host.appendCalls).toEqual([
      {
        draftId: "draft-abc",
        batch: [
          {
            path: "CreateDashboardPath",
            args: { id: "dashboard-1", name: "Executive" },
          },
        ],
        context: { sessionId: "session-1" },
      },
    ]);
    expect(result.details.commandResult).toEqual({ id: "dashboard-1" });
  });

  it("denies non-draft-safe commands before host.buildCommand or host.append", async () => {
    const buildCommand = vi.fn((type: string, args: unknown) => ({
      path: `${type}Path`,
      args,
    }));
    const host = makeHost({ buildCommand });
    const tool = createApplyCommandTool({ host, draftId: "draft-deny" });

    await expect(
      tool.execute("call-1", {
        type: "DeleteNode",
        args: { id: "source-1" },
      }),
    ).rejects.toThrow("not draft-safe");

    expect(buildCommand).not.toHaveBeenCalled();
    expect(host.appendCalls).toEqual([]);
  });

  it("rejects caller-supplied secret refs before host.buildCommand or host.append", async () => {
    const buildCommand = vi.fn((type: string, args: unknown) => ({
      path: `${type}Path`,
      args,
    }));
    const host = makeHost({ buildCommand });
    const tool = createApplyCommandTool({ host, draftId: "draft-ref" });

    await expect(
      tool.execute("call-1", {
        type: "CreateDataSource",
        args: {
          id: "source-1",
          type: "notion",
          name: "Notion",
          apiKey: "secret:00000000-0000-4000-8000-000000000000",
        },
      }),
    ).rejects.toThrow("must carry the plaintext credential");

    expect(buildCommand).not.toHaveBeenCalled();
    expect(host.appendCalls).toEqual([]);
  });

  it("stamps agent provenance before host.buildCommand", async () => {
    const buildCommand = vi.fn((type: string, args: unknown) => ({
      path: `${type}Path`,
      args,
    }));
    const host = makeHost({ buildCommand });
    const tool = createApplyCommandTool({ host, draftId: "draft-provenance" });

    await tool.execute("call-1", {
      type: "CreateDataSource",
      args: { id: "source-1", type: "csv", name: "CSV" },
    });

    expect(buildCommand).toHaveBeenCalledWith("CreateDataSource", {
      id: "source-1",
      type: "csv",
      name: "CSV",
      createdBy: { kind: "agent" },
    });
  });

  it("surfaces AssistantHost append result-count violations", async () => {
    const host = makeHost({ appendResult: [] });
    const tool = createApplyCommandTool({ host, draftId: "draft-bad-host" });

    await expect(
      tool.execute("call-1", {
        type: "CreateDashboard",
        args: { id: "dashboard-1", name: "Executive" },
      }),
    ).rejects.toThrow("AssistantHost contract violation");
  });
});
