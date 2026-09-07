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

const REGION_ID = "11111111-1111-4111-8111-111111111111";
const REVENUE_ID = "22222222-2222-4222-8222-222222222222";
const SALES_TABLE: DataTable = {
  ...TABLE,
  fields: [
    { ...TABLE.fields[0]!, id: REGION_ID as DataTable["id"] },
    {
      ...TABLE.fields[1]!,
      id: REVENUE_ID as DataTable["id"],
      name: "Revenue",
      columnName: "revenue",
      type: "number",
    },
  ],
};

function fixture(options?: {
  stageDraft?: WebMCPToolDependencies["mutations"]["stageDraft"];
  getDraftData?: WebMCPToolDependencies["read"]["getDraftData"];
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
    read: {
      getData: () => ({ ...defaults, ...options?.data }),
      getDraftData:
        options?.getDraftData ??
        (async () => ({
          insights: options?.data?.insights ?? defaults.insights ?? [],
          dataTables: options?.data?.dataTables ?? defaults.dataTables ?? [],
        })),
    },
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
      "add_to_dashboard",
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

  it("stages grouped SUM and uses its returned metric reference for a chart in the same draft", async () => {
    let stagedInsight: Insight | undefined;
    const stageDraft = vi.fn(
      async (commands: readonly Command[], _draftId?: string) => {
        const create = commands.find(
          (command) => command.path === "createInsightCmd",
        );
        if (create) stagedInsight = { ...create.args, createdAt: 1 } as Insight;
        return { draftId: "draft-42" };
      },
    );
    const getDraftData = vi.fn(async () => ({
      insights: stagedInsight ? [stagedInsight] : [],
      dataTables: [SALES_TABLE],
    }));
    const options = {
      stageDraft,
      getDraftData,
      data: { dataTables: [SALES_TABLE], insights: [] },
    };
    const insight = (await tool("propose_insight", options).execute({
      name: "Revenue by status",
      sourceType: "dataTable",
      sourceId: "table-1",
      selectedFieldIds: [REGION_ID],
      metrics: [
        { name: "Total revenue", aggregation: "sum", fieldId: REVENUE_ID },
      ],
      filters: [{ field: "status", operator: "eq", value: "open" }],
      sort: [{ field: "status", direction: "asc" }],
    })) as {
      draftId: string;
      insightId: string;
      metrics: { id: string; encoding: string }[];
    };
    const metric = insight.metrics[0]!;
    expect(metric.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(metric.encoding).toBe(`metric:${metric.id}`);
    expect(stageDraft.mock.calls[0]?.[0][0]?.args).toMatchObject({
      selectedFields: [REGION_ID],
      metrics: [
        {
          id: metric.id,
          name: "Total revenue",
          aggregation: "sum",
          columnName: "revenue",
          sourceTable: "table-1",
        },
      ],
    });
    const chart = (await tool("propose_chart", options).execute({
      draftId: insight.draftId,
      insightId: insight.insightId,
      name: "Revenue by status",
      chartType: "barY",
      encoding: { x: `field:${REGION_ID}`, y: metric.encoding },
    })) as Record<string, unknown>;
    const dashboard = (await tool("add_to_dashboard", options).execute({
      draftId: chart.draftId,
      dashboardId: "dashboard-1",
      visualizationId: chart.visualizationId,
    })) as Record<string, unknown>;
    expect(getDraftData).toHaveBeenCalledWith("draft-42");
    expect(chart).toMatchObject({
      draftId: "draft-42",
      status: "draft",
      visualizationId: expect.any(String),
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
    expect(stageDraft.mock.calls[1]?.[0][0]?.args).toMatchObject({
      encoding: { x: `field:${REGION_ID}`, y: metric.encoding },
    });
  });

  it.each([
    [
      { name: "Bad", aggregation: "sum", fieldId: "missing" },
      /outside this source/,
    ],
    [
      { name: "Bad", aggregation: "median", fieldId: REVENUE_ID },
      /aggregation must be/,
    ],
    [
      { name: "Bad", aggregation: "sum", fieldId: REGION_ID },
      /numeric source field/,
    ],
    [
      { name: "Bad", aggregation: "avg", fieldId: REGION_ID },
      /numeric source field/,
    ],
    [{ name: "Bad", aggregation: "sum" }, /fieldId is required/],
    [
      { name: "Bad", aggregation: "count", fieldId: REVENUE_ID },
      /omit fieldId/,
    ],
  ])(
    "rejects an invalid metric before staging: %j",
    async (metric, message) => {
      const stageDraft = vi.fn();
      await expect(
        tool("propose_insight", {
          stageDraft,
          data: { dataTables: [SALES_TABLE] },
        }).execute({
          name: "Revenue",
          sourceType: "dataTable",
          sourceId: "table-1",
          selectedFieldIds: [REGION_ID],
          metrics: [metric],
        }),
      ).rejects.toThrow(message);
      expect(stageDraft).not.toHaveBeenCalled();
    },
  );

  it("keeps pass-through behavior without metrics and supports row count without a source column", async () => {
    const stageDraft = vi.fn(async (_commands: readonly Command[]) => ({
      draftId: "draft-1",
    }));
    const propose = tool("propose_insight", { stageDraft });
    await propose.execute({
      name: "Orders",
      sourceType: "dataTable",
      sourceId: "table-1",
      selectedFieldIds: [],
    });
    await propose.execute({
      name: "Count",
      sourceType: "dataTable",
      sourceId: "table-1",
      selectedFieldIds: [],
      metrics: [{ name: "Rows", aggregation: "count" }],
    });
    expect(stageDraft.mock.calls[0]?.[0][0]?.args).toMatchObject({
      selectedFields: [],
      metrics: [],
    });
    expect(stageDraft.mock.calls[1]?.[0][0]?.args).toMatchObject({
      selectedFields: [],
      metrics: [{ aggregation: "count", sourceTable: "table-1" }],
    });
    const metrics = stageDraft.mock.calls[1]?.[0][0]?.args.metrics as Record<
      string,
      unknown
    >[];
    expect(metrics[0]).not.toHaveProperty("columnName");
  });

  it.each(["barY", "barX", "line", "areaY"])(
    "rejects a raw field on the %s aggregation axis before staging",
    async (chartType) => {
      const stageDraft = vi.fn();
      await expect(
        tool("propose_chart", {
          stageDraft,
          data: {
            dataTables: [SALES_TABLE],
            insights: [
              {
                ...INSIGHT,
                selectedFields: [
                  REGION_ID,
                  REVENUE_ID,
                ] as Insight["selectedFields"],
              },
            ],
          },
        }).execute({
          insightId: INSIGHT.id,
          name: "Revenue",
          chartType,
          encoding: { x: `field:${REGION_ID}`, y: `field:${REVENUE_ID}` },
        }),
      ).rejects.toThrow(/needs a metric/);
      expect(stageDraft).not.toHaveBeenCalled();
    },
  );

  it("checks draft output membership and fails closed if draft inspection fails", async () => {
    const stageDraft = vi.fn();
    const options = {
      stageDraft,
      data: {
        dataTables: [SALES_TABLE],
        insights: [
          {
            ...INSIGHT,
            selectedFields: [REGION_ID] as Insight["selectedFields"],
          },
        ],
      },
    };
    await expect(
      tool("propose_chart", options).execute({
        draftId: "draft-42",
        insightId: INSIGHT.id,
        name: "Revenue",
        chartType: "barY",
        encoding: { x: `field:${REGION_ID}`, y: `metric:${REVENUE_ID}` },
      }),
    ).rejects.toThrow(/outside this Insight's output/);
    await expect(
      tool("propose_chart", {
        ...options,
        getDraftData: async () => {
          throw new Error("Draft access denied");
        },
      }).execute({
        draftId: "draft-42",
        insightId: INSIGHT.id,
        name: "Revenue",
        chartType: "barY",
        encoding: {},
      }),
    ).rejects.toThrow("Draft access denied");
    expect(stageDraft).not.toHaveBeenCalled();
  });

  it.each([{ x: "region", y: "revenue" }, { x: { field: "region" } }])(
    "rejects unusable chart encodings before staging: %j",
    async (encoding) => {
      const stageDraft = vi.fn();
      await expect(
        tool("propose_chart", { stageDraft }).execute({
          draftId: "draft-42",
          insightId: "insight-1",
          name: "Revenue",
          chartType: "barY",
          encoding,
        }),
      ).rejects.toThrow(/encoding/);
      expect(stageDraft).not.toHaveBeenCalled();
    },
  );

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

  it("rejects non-executable filter references and sorts outside the result", async () => {
    const stageDraft = vi.fn(async () => ({ draftId: "draft-1" }));
    const proposeInsight = tool("propose_insight", { stageDraft });
    const base = {
      name: "Open orders",
      sourceType: "dataTable",
      sourceId: "table-1",
      selectedFieldIds: ["field-status"],
    };

    for (const field of ["field-status", "Status"]) {
      await expect(
        proposeInsight.execute({
          ...base,
          filters: [{ field, operator: "eq", value: "open" }],
        }),
      ).rejects.toThrow("filters contains a field outside this source");
    }
    await expect(
      proposeInsight.execute({
        ...base,
        sort: [{ field: "created_at", direction: "desc" }],
      }),
    ).rejects.toThrow("sort contains a field outside this source");
    expect(stageDraft).not.toHaveBeenCalled();
  });

  it("accepts executable fields from an unconfigured source Insight", async () => {
    const stageDraft = vi.fn(async () => ({ draftId: "draft-1" }));
    const unconfigured = {
      ...INSIGHT,
      id: "unconfigured-insight",
      selectedFields: [],
      metrics: [],
    } as Insight;

    await expect(
      tool("propose_insight", {
        stageDraft,
        data: { insights: [INSIGHT, unconfigured] },
      }).execute({
        name: "Derived orders",
        sourceType: "insight",
        sourceId: unconfigured.id,
        selectedFieldIds: ["field-status"],
        filters: [
          { field: "field_field_status", operator: "eq", value: "open" },
        ],
        sort: [{ field: "field_field_status", direction: "asc" }],
      }),
    ).resolves.toMatchObject({ status: "draft" });
    expect(stageDraft).toHaveBeenCalledOnce();
  });

  it("accepts only field ids in selectedFieldIds", async () => {
    const stageDraft = vi.fn(async () => ({ draftId: "draft-1" }));
    await expect(
      tool("propose_insight", { stageDraft }).execute({
        name: "Broken",
        sourceType: "dataTable",
        sourceId: "table-1",
        selectedFieldIds: ["Status"],
      }),
    ).rejects.toThrow("selectedFieldIds contains a field outside this source");
    expect(stageDraft).not.toHaveBeenCalled();
  });

  it("requires selectedFieldIds at execution and accepts an explicit empty list", async () => {
    const stageDraft = vi.fn(async () => ({ draftId: "draft-1" }));
    const proposeInsight = tool("propose_insight", { stageDraft });
    await expect(
      proposeInsight.execute({
        name: "Missing fields",
        sourceType: "dataTable",
        sourceId: "table-1",
      }),
    ).rejects.toThrow("selectedFieldIds must be an array of strings");
    expect(stageDraft).not.toHaveBeenCalled();

    await expect(
      proposeInsight.execute({
        name: "Pass through",
        sourceType: "dataTable",
        sourceId: "table-1",
        selectedFieldIds: [],
      }),
    ).resolves.toMatchObject({ status: "draft" });
    expect(stageDraft).toHaveBeenCalledOnce();
  });

  it("rejects an unknown insight source even when appending to a draft", async () => {
    const stageDraft = vi.fn(async () => ({ draftId: "draft-1" }));
    await expect(
      tool("propose_insight", { stageDraft }).execute({
        draftId: "draft-1",
        name: "Broken composition",
        sourceType: "dataTable",
        sourceId: "other-project-table",
        selectedFieldIds: ["other-table-field"],
        filters: [{ field: "other_field", operator: "eq", value: 1 }],
        sort: [{ field: "other_field", direction: "asc" }],
      }),
    ).rejects.toThrow("Insight source not found");
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

  it("returns the insight edits that have not finished saving", async () => {
    useWebMCPPageStore.getState().setInsight({
      insightId: "insight-1",
      pendingName: "Pending revenue",
      pendingFilters: [
        { id: "filter-1", field: "status", operator: "eq", value: "open" },
      ],
      pendingSorts: [{ field: "created_at", direction: "desc" }],
    });
    await expect(tool("whats_on_screen").execute({})).resolves.toMatchObject({
      openInsight: {
        unsaved: {
          pendingName: "Pending revenue",
          filters: [{ field: "status", value: "open" }],
          sorts: [{ field: "created_at", direction: "desc" }],
        },
      },
    });
    useWebMCPPageStore.getState().setInsight(null);
  });

  it("reports page metadata loading instead of claiming no artifact is open", async () => {
    await expect(
      tool("whats_on_screen", {
        route: "/insights/insight-1",
        data: { insights: undefined },
      }).execute({}),
    ).rejects.toThrow("Insights are still loading");
    await expect(
      tool("whats_on_screen", {
        route: "/dashboards/dashboard-1",
        data: { dashboards: undefined },
      }).execute({}),
    ).rejects.toThrow("Dashboards are still loading");
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

  it("continues registration and retains cleanup after a synchronous rejection", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registered: string[] = [];
    const signals: AbortSignal[] = [];
    Object.defineProperty(document, "modelContext", {
      value: {
        registerTool: (
          registeredTool: WebMCPToolDefinition,
          options?: { signal?: AbortSignal },
        ) => {
          if (registeredTool.name === "list_connectors")
            throw new Error("descriptor rejected");
          registered.push(registeredTool.name);
          if (options?.signal) signals.push(options.signal);
        },
      } satisfies WebMCPModelContext,
      configurable: true,
    });
    const view = render(<RegistryProbe tools={fixture().tools} />);
    expect(registered).toEqual(EXPECTED_TOOLS.slice(1));
    expect(new Set(signals).size).toBe(1);
    expect(warning).toHaveBeenCalledWith(
      "[dashframe] Could not register list_connectors",
      expect.any(Error),
    );
    view.unmount();
    expect(signals[0]?.aborted).toBe(true);
    delete document.modelContext;
    warning.mockRestore();
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
