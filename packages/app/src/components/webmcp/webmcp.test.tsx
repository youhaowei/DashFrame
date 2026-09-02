import { useWebMCPPageStore } from "@/lib/stores/webmcp-page-store";
import type { Command, DataTable, Insight } from "@dashframe/types";
import { render } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  createWebMCPHighlightController,
  useWebMCPHighlightController,
} from "./highlight";
import {
  createWebMCPTools,
  defineWebMCPToolDependencies,
  type WebMCPToolData,
  type WebMCPToolDependencies,
} from "./tools";
import {
  useWebMCPTools,
  type WebMCPModelContext,
  type WebMCPToolDefinition,
} from "./webmcp";

const { queryDataFrameMock } = vi.hoisted(() => ({
  queryDataFrameMock: vi.fn(),
}));
vi.mock("@/lib/data-access/data-frames", () => ({
  queryDataFrame: queryDataFrameMock,
}));

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

const TABLE = {
  id: "table-1",
  name: "Orders",
  dataSourceId: "source-1",
  table: "orders",
  dataFrameId: "frame-1",
  fields: [
    {
      id: "field-status",
      name: "Status",
      columnName: "status",
      tableId: "table-1",
      type: "string",
      sensitivity: "unclassified",
    },
    {
      id: "field-created",
      name: "Created at",
      columnName: "created_at",
      tableId: "table-1",
      type: "date",
      sensitivity: "cleared",
    },
  ],
  metrics: [],
  createdAt: 1,
} as DataTable;

const INSIGHT = {
  id: "insight-1",
  name: "Revenue",
  source: { sourceType: "dataTable", sourceId: "table-1" },
  selectedFields: ["field-status", "field-created"],
  metrics: [],
  createdAt: 1,
} as Insight;

function fixture(options?: {
  stageDraft?: WebMCPToolDependencies["mutations"]["stageDraft"];
  route?: string;
  navigateToDraft?: WebMCPToolDependencies["ui"]["navigateToDraft"];
  data?: Partial<WebMCPToolData>;
  highlight?: WebMCPToolDependencies["ui"]["highlight"];
}) {
  const controller = createWebMCPHighlightController(document);
  const defaults: WebMCPToolData = {
    route: options?.route ?? "/insights/insight-1",
    connectors: [],
    dataSources: [],
    dataTables: [TABLE],
    insights: [INSIGHT],
    visualizations: [
      {
        id: "visualization-1",
        name: "Revenue chart",
        insightId: "insight-1",
        visualizationType: "barY",
        encoding: {},
        spec: {},
        createdAt: 1,
      },
    ],
    dashboards: [
      {
        id: "dashboard-1",
        name: "Operations",
        items: [
          {
            id: "widget-1",
            type: "visualization",
            visualizationId: "visualization-1",
            x: 0,
            y: 0,
            width: 6,
            height: 6,
          },
        ],
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
    drafts: [{ draftId: "draft-1" }, { draftId: "draft-42" }],
  };
  const dependencies = defineWebMCPToolDependencies({
    read: { getData: () => ({ ...defaults, ...options?.data }) },
    mutations: {
      stageDraft: options?.stageDraft ?? (async () => ({ draftId: "draft-1" })),
    },
    ui: {
      navigateToDraft:
        options?.navigateToDraft ??
        (async (draftId) => ({ route: `/generated/${draftId}` })),
      highlight: options?.highlight ?? controller.highlight,
    },
  });
  return { controller, dependencies, tools: createWebMCPTools(dependencies) };
}

function tool(
  name: (typeof EXPECTED_TOOLS)[number],
  options?: Parameters<typeof fixture>[0],
) {
  return fixture(options).tools.find((candidate) => candidate.name === name)!;
}

function RegistryProbe({ tools }: { tools: readonly WebMCPToolDefinition[] }) {
  useWebMCPTools(tools);
  return null;
}

function HighlightProbe({ id }: { id: string }) {
  const controller = useWebMCPHighlightController(document);
  useEffect(() => {
    controller.highlight("widget", id);
  }, [controller, id]);
  return null;
}

describe("DashFrame WebMCP registry", () => {
  it("declares the complete, review-safe tool set", () => {
    const tools = fixture().tools;
    expect(tools.map((candidate) => candidate.name)).toEqual(EXPECTED_TOOLS);
    expect(
      tools.filter((candidate) => /publish|commit/i.test(candidate.name)),
    ).toEqual([]);
  });

  it("can reach only the draft staging mutation", () => {
    const { dependencies } = fixture();
    expect(Object.keys(dependencies)).toEqual(["read", "mutations", "ui"]);
    expect(Object.keys(dependencies.mutations)).toEqual(["stageDraft"]);
    expect(() =>
      createWebMCPTools({
        ...dependencies,
        mutations: {
          ...dependencies.mutations,
          stageApply: vi.fn(),
        },
      } as WebMCPToolDependencies),
    ).toThrow("only the draft staging mutation");
  });

  it("annotates read and imported-content tools honestly", () => {
    const tools = fixture().tools;
    expect(
      tools
        .filter((candidate) => candidate.annotations?.readOnlyHint)
        .map((candidate) => candidate.name),
    ).toEqual([
      "list_connectors",
      "list_data_sources",
      "describe_table",
      "query_data",
      "whats_on_screen",
    ]);
    expect(
      tools
        .filter((candidate) => candidate.annotations?.untrustedContentHint)
        .map((candidate) => candidate.name),
    ).toEqual([
      "list_data_sources",
      "describe_table",
      "query_data",
      "whats_on_screen",
    ]);
  });

  it("publishes closed JSON schemas for every tool", () => {
    const tools = fixture().tools;
    for (const candidate of tools) {
      expect(candidate.inputSchema).toMatchObject({
        type: "object",
        properties: expect.any(Object),
        additionalProperties: false,
      });
    }
    const byName = new Map(
      tools.map((candidate) => [candidate.name, candidate.inputSchema]),
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
      properties: { draftId: { type: "string" } },
    });
    expect(byName.get("propose_chart")).toMatchObject({
      required: ["insightId", "name", "chartType", "encoding"],
      properties: { draftId: { type: "string" } },
    });
    expect(byName.get("add_to_dashboard")).toMatchObject({
      required: ["dashboardId", "visualizationId"],
      properties: { draftId: { type: "string" } },
    });
    expect(byName.get("show_draft")).toMatchObject({ required: ["draftId"] });
    expect(byName.get("highlight_widget")).toMatchObject({
      required: ["kind", "id"],
    });
  });

  it("returns artifact ids and composes all proposals in one draft", async () => {
    const stageDraft = vi.fn(
      async (_commands: readonly Command[], _draftId?: string) => ({
        draftId: "draft-42",
      }),
    );
    const options = { stageDraft };
    const insight = (await tool("propose_insight", options).execute({
      name: "Open orders",
      sourceType: "dataTable",
      sourceId: "table-1",
      selectedFieldIds: ["field-status"],
      filters: [{ field: "status", operator: "eq", value: "open" }],
      sort: [{ field: "created_at", direction: "desc" }],
    })) as Record<string, unknown>;
    const chart = (await tool("propose_chart", options).execute({
      draftId: insight.draftId,
      insightId: insight.insightId,
      name: "Open orders",
      chartType: "barY",
      encoding: {},
    })) as Record<string, unknown>;
    const dashboard = (await tool("add_to_dashboard", options).execute({
      draftId: chart.draftId,
      dashboardId: "dashboard-1",
      visualizationId: chart.visualizationId,
    })) as Record<string, unknown>;

    expect(insight).toMatchObject({
      draftId: "draft-42",
      insightId: expect.any(String),
      status: "draft",
    });
    expect(chart).toMatchObject({
      draftId: "draft-42",
      visualizationId: expect.any(String),
      status: "draft",
    });
    expect(dashboard).toMatchObject({
      draftId: "draft-42",
      visualizationId: chart.visualizationId,
      widgetId: expect.any(String),
      status: "draft",
    });
    expect(stageDraft.mock.calls.map((call) => call[1])).toEqual([
      undefined,
      "draft-42",
      "draft-42",
    ]);
    expect(
      stageDraft.mock.calls[0]?.[0].map((command) => command.path),
    ).toEqual(["createInsightCmd", "setInsightFilter", "setInsightSort"]);
    expect(
      stageDraft.mock.calls.slice(1).map((call) => call[0][0]?.path),
    ).toEqual(["createVisualizationCmd", "addDashboardItemCmd"]);
  });

  it("reports write-side loading separately from missing artifacts", async () => {
    await expect(
      tool("propose_insight", { data: { dataTables: undefined } }).execute({
        name: "Orders",
        sourceType: "dataTable",
        sourceId: "table-1",
        selectedFieldIds: [],
      }),
    ).rejects.toThrow("Data tables are still loading");
    await expect(
      tool("propose_chart", { data: { insights: undefined } }).execute({
        insightId: "insight-1",
        name: "Chart",
        chartType: "barY",
        encoding: {},
      }),
    ).rejects.toThrow("Insights are still loading");
    await expect(
      tool("add_to_dashboard", { data: { dashboards: undefined } }).execute({
        dashboardId: "dashboard-1",
        visualizationId: "visualization-1",
      }),
    ).rejects.toThrow("Dashboards are still loading");
    await expect(
      tool("add_to_dashboard", { data: { visualizations: undefined } }).execute(
        {
          dashboardId: "dashboard-1",
          visualizationId: "visualization-1",
        },
      ),
    ).rejects.toThrow("Visualizations are still loading");
  });

  it("rejects insight fields that do not belong to its source", async () => {
    const stageDraft = vi.fn(async () => ({ draftId: "draft-1" }));
    const base = {
      name: "Broken",
      sourceType: "dataTable",
      sourceId: "table-1",
      selectedFieldIds: ["field-status"],
    };
    await expect(
      tool("propose_insight", { stageDraft }).execute({
        ...base,
        selectedFieldIds: ["other-table-field"],
      }),
    ).rejects.toThrow("selectedFieldIds contains a field outside this source");
    await expect(
      tool("propose_insight", { stageDraft }).execute({
        ...base,
        filters: [{ field: "other_field", operator: "eq", value: 1 }],
      }),
    ).rejects.toThrow("filters contains a field outside this source");
    await expect(
      tool("propose_insight", { stageDraft }).execute({
        ...base,
        sort: [{ field: "other_field", direction: "asc" }],
      }),
    ).rejects.toThrow("sort contains a field outside this source");
    expect(stageDraft).not.toHaveBeenCalled();
  });

  it("applies the assistant privacy floor to returned cell values", async () => {
    queryDataFrameMock.mockResolvedValue({
      status: "ready",
      schema: [
        { id: "field-status", name: "Status", type: "string" },
        { id: "field-created", name: "Created at", type: "date" },
      ],
      rows: [
        {
          "field-status": "private-status",
          "field-created": "2026-09-02",
        },
      ],
      totalCount: 1,
      page: { offset: 0, limit: 50, returned: 1 },
    });
    await expect(
      tool("query_data").execute({ tableId: "table-1" }),
    ).resolves.toMatchObject({
      masked: true,
      valueTier: "mixed",
      rows: [{ Status: "<text>", "Created at": "2026-09-02" }],
    });
    await expect(
      tool("describe_table").execute({ tableId: "table-1" }),
    ).resolves.toMatchObject({
      masked: true,
      valueTier: "mixed",
      columns: [
        { id: "field-status", sampleValues: ["<text>"] },
        { id: "field-created", sampleValues: ["2026-09-02"] },
      ],
    });
  });

  it("returns live controls and reachable dashboard widget ids", async () => {
    useWebMCPPageStore.getState().setDashboard({
      dashboardId: "dashboard-1",
      transientControlValues: { "control-1": "open" },
    });
    await expect(
      tool("whats_on_screen", { route: "/dashboards/dashboard-1" }).execute({}),
    ).resolves.toMatchObject({
      openDashboard: {
        items: [{ id: "widget-1", visualizationId: "visualization-1" }],
        unsavedControlValues: { "control-1": "open" },
      },
    });
    useWebMCPPageStore.getState().setDashboard(null);
  });

  it("verifies a draft and returns the generated route", async () => {
    const navigateToDraft = vi.fn(async () => ({ route: "/router/draft-42" }));
    await expect(
      tool("show_draft", { navigateToDraft }).execute({ draftId: "draft-42" }),
    ).resolves.toEqual({
      draftId: "draft-42",
      route: "/router/draft-42",
      summary: "Draft review is now open.",
    });
    await expect(
      tool("show_draft", { navigateToDraft }).execute({ draftId: "stale" }),
    ).rejects.toThrow("Draft not found");
    await expect(
      tool("show_draft", {
        navigateToDraft,
        data: { drafts: undefined },
      }).execute({ draftId: "draft-42" }),
    ).rejects.toThrow("Drafts are still loading");
    expect(navigateToDraft).toHaveBeenCalledTimes(1);
  });

  it("keeps one highlight timer across tool rebuilds", async () => {
    vi.useFakeTimers();
    const widget = document.createElement("div");
    widget.dataset.dashframeWidgetId = "widget-1";
    document.body.append(widget);
    const controller = createWebMCPHighlightController(document);
    const options = { highlight: controller.highlight };
    await tool("highlight_widget", options).execute({
      kind: "widget",
      id: "widget-1",
    });
    vi.advanceTimersByTime(2_000);
    await tool("highlight_widget", options).execute({
      kind: "widget",
      id: "widget-1",
    });
    vi.advanceTimersByTime(2_001);
    expect(widget.dataset.webmcpHighlight).toBe("true");
    vi.advanceTimersByTime(1_999);
    expect(widget.dataset.webmcpHighlight).toBeUndefined();
    controller.dispose();
    widget.remove();
    vi.useRealTimers();
  });

  it("clears a pending highlight on provider unmount", () => {
    vi.useFakeTimers();
    const widget = document.createElement("div");
    widget.dataset.dashframeWidgetId = "widget-1";
    document.body.append(widget);
    const view = render(<HighlightProbe id="widget-1" />);
    expect(widget.dataset.webmcpHighlight).toBe("true");
    view.unmount();
    expect(widget.dataset.webmcpHighlight).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    widget.remove();
    vi.useRealTimers();
  });

  it("uses one registration AbortSignal and aborts it on unmount", () => {
    const registrations: Array<{
      tool: WebMCPToolDefinition;
      signal: AbortSignal | undefined;
    }> = [];
    Object.defineProperty(document, "modelContext", {
      value: {
        registerTool: (
          registeredTool: WebMCPToolDefinition,
          options?: { signal?: AbortSignal },
        ) => {
          registrations.push({ tool: registeredTool, signal: options?.signal });
        },
      } satisfies WebMCPModelContext,
      configurable: true,
    });
    const view = render(<RegistryProbe tools={fixture().tools} />);
    expect(
      registrations.map(({ tool: registeredTool }) => registeredTool.name),
    ).toEqual(EXPECTED_TOOLS);
    expect(new Set(registrations.map(({ signal }) => signal)).size).toBe(1);
    expect(registrations[0]?.signal?.aborted).toBe(false);
    view.unmount();
    expect(registrations[0]?.signal?.aborted).toBe(true);
    delete document.modelContext;
  });

  it("registers through navigator.modelContext when only that form exists", () => {
    const registered: string[] = [];
    delete document.modelContext;
    Object.defineProperty(navigator, "modelContext", {
      value: {
        registerTool: (registeredTool: WebMCPToolDefinition) => {
          registered.push(registeredTool.name);
        },
      } satisfies WebMCPModelContext,
      configurable: true,
    });
    render(<RegistryProbe tools={fixture().tools} />);
    expect(registered).toEqual(EXPECTED_TOOLS);
    delete navigator.modelContext;
  });

  it("prefers document.modelContext when both forms exist", () => {
    const viaDocument: string[] = [];
    const viaNavigator: string[] = [];
    Object.defineProperty(document, "modelContext", {
      value: {
        registerTool: (registeredTool: WebMCPToolDefinition) => {
          viaDocument.push(registeredTool.name);
        },
      } satisfies WebMCPModelContext,
      configurable: true,
    });
    Object.defineProperty(navigator, "modelContext", {
      value: {
        registerTool: (registeredTool: WebMCPToolDefinition) => {
          viaNavigator.push(registeredTool.name);
        },
      } satisfies WebMCPModelContext,
      configurable: true,
    });
    render(<RegistryProbe tools={fixture().tools} />);
    expect(viaDocument).toEqual(EXPECTED_TOOLS);
    expect(viaNavigator).toEqual([]);
    delete document.modelContext;
    delete navigator.modelContext;
  });

  it("is a clean no-op when WebMCP is absent", () => {
    delete document.modelContext;
    delete navigator.modelContext;
    expect(() =>
      render(<RegistryProbe tools={fixture().tools} />),
    ).not.toThrow();
  });
});
