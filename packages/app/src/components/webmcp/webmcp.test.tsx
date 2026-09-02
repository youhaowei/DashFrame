import { render } from "@testing-library/react";
import { useWebMCPPageStore } from "@/lib/stores/webmcp-page-store";
import type { Command, DataTable, Insight } from "@dashframe/types";
import { describe, expect, it, vi } from "vite-plus/test";
import { createWebMCPTools } from "./tools";
import {
  useWebMCPTools,
  type WebMCPModelContext,
  type WebMCPToolDefinition,
} from "./webmcp";

const EXPECTED_TOOLS = [
  "list_connectors",
  "list_data_sources",
  "describe_table",
  "query_data",
  "propose_insight",
  "propose_chart",
  "add_to_dashboard",
  "whats_on_screen",
  "show_draft",
  "highlight_widget",
] as const;

function fixtureTools(options?: {
  stageDraft?: (commands: readonly Command[]) => Promise<{ draftId: string }>;
  route?: string;
  navigateToDraft?: (draftId: string) => Promise<void> | void;
}) {
  return createWebMCPTools({
    getData: () => ({
      route: options?.route ?? "/insights/insight-1",
      connectors: [],
      dataSources: [],
      dataTables: [
        {
          id: "table-1",
          name: "Orders",
          dataSourceId: "source-1",
          table: "orders",
          fields: [],
          metrics: [],
          createdAt: 1,
        } as DataTable,
      ],
      insights: [
        {
          id: "insight-1",
          name: "Revenue",
          source: { sourceType: "dataTable", sourceId: "table-1" },
          selectedFields: [],
          metrics: [],
          createdAt: 1,
        } as Insight,
      ],
      visualizations: [],
      dashboards: [
        {
          id: "dashboard-1",
          name: "Operations",
          items: [],
          controls: [
            {
              id: "control-1",
              field: "status",
              defaultValue: "all",
              boundInstances: [],
            },
          ],
          createdAt: 1,
        },
      ],
    }),
    stageDraft: options?.stageDraft ?? (async () => ({ draftId: "draft-1" })),
    navigateToDraft: options?.navigateToDraft ?? vi.fn(),
    document,
  });
}

function RegistryProbe({ tools }: { tools: readonly WebMCPToolDefinition[] }) {
  useWebMCPTools(tools);
  return null;
}

describe("DashFrame WebMCP registry", () => {
  it("declares the complete, review-safe tool set", () => {
    const tools = fixtureTools();
    expect(tools.map((tool) => tool.name)).toEqual(EXPECTED_TOOLS);
    expect(tools.filter((tool) => /publish|commit/i.test(tool.name))).toEqual(
      [],
    );
  });

  it("annotates every read tool and no proposal or UI action as read-only", () => {
    const tools = fixtureTools();
    const readOnly = tools
      .filter((tool) => tool.annotations?.readOnlyHint)
      .map((tool) => tool.name);
    expect(readOnly).toEqual([
      "list_connectors",
      "list_data_sources",
      "describe_table",
      "query_data",
      "whats_on_screen",
    ]);
  });

  it("publishes closed JSON schemas for every tool", () => {
    for (const tool of fixtureTools()) {
      expect(tool.inputSchema).toMatchObject({
        type: "object",
        properties: expect.any(Object),
        additionalProperties: false,
      });
    }

    const byName = new Map(
      fixtureTools().map((tool) => [tool.name, tool.inputSchema]),
    );
    expect(byName.get("describe_table")).toMatchObject({
      required: ["tableId"],
    });
    expect(byName.get("query_data")).toMatchObject({
      required: ["tableId"],
      properties: { limit: { maximum: 100 }, sort: { maxItems: 3 } },
    });
    expect(byName.get("propose_insight")).toMatchObject({
      required: ["name", "sourceType", "sourceId", "selectedFieldIds"],
    });
    expect(byName.get("propose_chart")).toMatchObject({
      required: ["insightId", "name", "chartType", "encoding"],
    });
    expect(byName.get("add_to_dashboard")).toMatchObject({
      required: ["dashboardId", "visualizationId"],
    });
    expect(byName.get("show_draft")).toMatchObject({ required: ["draftId"] });
    expect(byName.get("highlight_widget")).toMatchObject({
      required: ["kind", "id"],
    });
  });

  it("stages proposal commands through the draft dependency", async () => {
    const stageDraft = vi.fn(async () => ({ draftId: "draft-42" }));
    const tool = fixtureTools({ stageDraft }).find(
      (candidate) => candidate.name === "propose_insight",
    );
    const result = await tool?.execute({
      name: "Open orders",
      sourceType: "dataTable",
      sourceId: "table-1",
      selectedFieldIds: [],
      filters: [{ field: "status", operator: "eq", value: "open" }],
      sort: [{ field: "created_at", direction: "desc" }],
    });

    expect(stageDraft).toHaveBeenCalledTimes(1);
    expect(
      stageDraft.mock.calls[0]?.[0].map((command) => command.path),
    ).toEqual(["createInsightCmd", "setInsightFilter", "setInsightSort"]);
    expect(result).toMatchObject({ draftId: "draft-42", status: "draft" });
  });

  it("returns the human's unsaved dashboard controls from live page state", async () => {
    useWebMCPPageStore.getState().setDashboard({
      dashboardId: "dashboard-1",
      transientControlValues: { "control-1": "open" },
    });
    const tool = fixtureTools({ route: "/dashboards/dashboard-1" }).find(
      (candidate) => candidate.name === "whats_on_screen",
    );

    await expect(tool?.execute({})).resolves.toMatchObject({
      route: "/dashboards/dashboard-1",
      openDashboard: {
        id: "dashboard-1",
        unsavedControlValues: { "control-1": "open" },
      },
    });
    useWebMCPPageStore.getState().setDashboard(null);
  });

  it("navigates to review without exposing a publish action", async () => {
    const navigateToDraft = vi.fn();
    const tool = fixtureTools({ navigateToDraft }).find(
      (candidate) => candidate.name === "show_draft",
    );

    await expect(tool?.execute({ draftId: "draft-42" })).resolves.toMatchObject(
      {
        draftId: "draft-42",
        summary: "Draft review is now open.",
      },
    );
    expect(navigateToDraft).toHaveBeenCalledWith("draft-42");
  });

  it("highlights a visible item and clears the treatment", async () => {
    vi.useFakeTimers();
    const widget = document.createElement("div");
    widget.dataset.dashframeWidgetId = "widget-1";
    document.body.append(widget);
    const tool = fixtureTools().find(
      (candidate) => candidate.name === "highlight_widget",
    );

    await tool?.execute({ kind: "widget", id: "widget-1" });
    expect(widget.dataset.webmcpHighlight).toBe("true");
    vi.advanceTimersByTime(4_000);
    expect(widget.dataset.webmcpHighlight).toBeUndefined();

    widget.remove();
    vi.useRealTimers();
  });

  it("uses one registration AbortSignal and aborts it on unmount", () => {
    const registrations: Array<{
      tool: WebMCPToolDefinition;
      signal: AbortSignal | undefined;
    }> = [];
    const modelContext: WebMCPModelContext = {
      registerTool: (tool, options) => {
        registrations.push({ tool, signal: options?.signal });
      },
    };
    Object.defineProperty(document, "modelContext", {
      value: modelContext,
      configurable: true,
    });

    const view = render(<RegistryProbe tools={fixtureTools()} />);
    expect(registrations.map(({ tool }) => tool.name)).toEqual(EXPECTED_TOOLS);
    const signals = new Set(registrations.map(({ signal }) => signal));
    expect(signals.size).toBe(1);
    expect(registrations[0]?.signal?.aborted).toBe(false);

    view.unmount();
    expect(registrations[0]?.signal?.aborted).toBe(true);
    delete document.modelContext;
  });

  it("registers through navigator.modelContext when only that form exists", () => {
    // The WebMCP origin trial (Chrome 149-156) still ships the `navigator`
    // spelling. Detecting only `document` registers nothing there, and does it
    // silently — the page looks healthy and simply has no tools.
    const registered: string[] = [];
    delete document.modelContext;
    Object.defineProperty(navigator, "modelContext", {
      value: {
        registerTool: (tool: WebMCPToolDefinition) => {
          registered.push(tool.name);
        },
      } satisfies WebMCPModelContext,
      configurable: true,
    });

    render(<RegistryProbe tools={fixtureTools()} />);
    expect(registered).toEqual(EXPECTED_TOOLS);
    delete navigator.modelContext;
  });

  it("prefers document.modelContext when both forms exist", () => {
    const viaDocument: string[] = [];
    const viaNavigator: string[] = [];
    Object.defineProperty(document, "modelContext", {
      value: {
        registerTool: (tool: WebMCPToolDefinition) => {
          viaDocument.push(tool.name);
        },
      } satisfies WebMCPModelContext,
      configurable: true,
    });
    Object.defineProperty(navigator, "modelContext", {
      value: {
        registerTool: (tool: WebMCPToolDefinition) => {
          viaNavigator.push(tool.name);
        },
      } satisfies WebMCPModelContext,
      configurable: true,
    });

    render(<RegistryProbe tools={fixtureTools()} />);
    expect(viaDocument).toEqual(EXPECTED_TOOLS);
    expect(viaNavigator).toEqual([]);
    delete document.modelContext;
    delete navigator.modelContext;
  });

  it("is a clean no-op when WebMCP is absent", () => {
    delete document.modelContext;
    delete navigator.modelContext;
    expect(() =>
      render(<RegistryProbe tools={fixtureTools()} />),
    ).not.toThrow();
  });
});
