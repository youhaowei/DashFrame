import { useConfirmDialogStore } from "@/lib/stores/confirm-dialog-store";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { fieldIdToColumnAlias } from "@dashframe/engine";
import { buildInsightUpdateCommands } from "@dashframe/types";
import type { DataTable, Insight, UUID } from "@dashframe/types";

const { mockToastError } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: mockToastError } }));

import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  buildChartSuggestionInsight,
  buildInsightModelMetadata,
  canAttemptVisualizeIntent,
  canChangeSavedVisualizationType,
  MAX_DOT_ROW_COUNT,
  requestSavedVisualizationDeletion,
  resolveAddToReportTarget,
  resolveSuggestionDimensionFieldIds,
  resolveNewChartTarget,
  resolvePendingNewChartTarget,
  shouldMaterializeChartSuggestion,
} from "./InsightView";

describe("buildInsightModelMetadata", () => {
  it("labels an unselected repeat-join metric source without materializing rows", () => {
    const ordersId = "10000000-0000-4000-8000-000000000001" as UUID;
    const usersId = "10000000-0000-4000-8000-000000000002" as UUID;
    const userId = "10000000-0000-4000-8000-000000000003" as UUID;
    const userNameId = "10000000-0000-4000-8000-000000000004" as UUID;
    const orders = {
      id: ordersId,
      name: "Orders",
      dataFrameId: "orders-frame",
      fields: [
        {
          id: "10000000-0000-4000-8000-000000000005",
          tableId: ordersId,
          name: "Created by",
          columnName: "created_by",
          type: "string",
        },
        {
          id: "10000000-0000-4000-8000-000000000006",
          tableId: ordersId,
          name: "Approved by",
          columnName: "approved_by",
          type: "string",
        },
      ],
    } as DataTable;
    const users = {
      id: usersId,
      name: "Users",
      dataFrameId: "users-frame",
      fields: [
        {
          id: userId,
          tableId: usersId,
          name: "ID",
          columnName: "id",
          type: "string",
        },
        {
          id: userNameId,
          tableId: usersId,
          name: "User name",
          columnName: "name",
          type: "string",
        },
      ],
    } as DataTable;
    const insight = {
      id: "10000000-0000-4000-8000-000000000007",
      name: "Approvals",
      source: { sourceType: "insight", sourceId: "upstream-insight" },
      selectedFields: [],
      metrics: [
        {
          id: "10000000-0000-4000-8000-000000000008",
          name: "Approver count",
          aggregation: "count_distinct",
          columnName: `${fieldIdToColumnAlias(userNameId)}_j1`,
        },
      ],
      joins: [
        { rightTableId: usersId, leftKey: "created_by", rightKey: "id" },
        { rightTableId: usersId, leftKey: "approved_by", rightKey: "id" },
      ],
      createdAt: 0,
    } as Insight;

    const metadata = buildInsightModelMetadata(insight, orders, [
      orders,
      users,
    ]);

    expect(
      metadata.columnDisplayNames[`${fieldIdToColumnAlias(userNameId)}_j1`],
    ).toBe("User name (approved_by)");
  });
});

describe("shouldMaterializeChartSuggestion", () => {
  const tableView = { kind: "table" as const };

  it("starts the suggestion request for a manual Visualize request", () => {
    expect(
      shouldMaterializeChartSuggestion({
        activeView: tableView,
        visualizeIntent: false,
        hasVisualization: false,
        visualModeRequested: true,
      }),
    ).toBe(true);
  });

  it("keeps suggestions idle in an ordinary table view", () => {
    expect(
      shouldMaterializeChartSuggestion({
        activeView: tableView,
        visualizeIntent: false,
        hasVisualization: false,
        visualModeRequested: false,
      }),
    ).toBe(false);
  });
});

describe("canChangeSavedVisualizationType", () => {
  const numericAnalysis = [
    { columnName: "amount", dataType: "DOUBLE", semantic: "numerical" },
    { columnName: "quantity", dataType: "DOUBLE", semantic: "numerical" },
  ] as never;
  const compiledInsight = { metrics: [], dimensions: [] } as never;
  const densityVisualization = {
    visualizationType: "hexbin" as const,
    encoding: { x: "amount", y: "quantity" },
  };

  it("allows Dot at 10000 rows and blocks it above the raw-point limit", () => {
    const common = {
      visualization: densityVisualization,
      chartType: "dot" as const,
      encodingsReady: true,
      encodingColumnAnalysis: numericAnalysis,
      compiledInsight,
    };

    expect(
      canChangeSavedVisualizationType({
        ...common,
        encodingRowCount: MAX_DOT_ROW_COUNT,
      }),
    ).toBe(true);
    expect(
      canChangeSavedVisualizationType({
        ...common,
        encodingRowCount: MAX_DOT_ROW_COUNT + 1,
      }),
    ).toBe(false);
  });

  it("keeps the current Dot visualization available above the limit", () => {
    expect(
      canChangeSavedVisualizationType({
        visualization: {
          ...densityVisualization,
          visualizationType: "dot",
        },
        chartType: "dot",
        encodingsReady: true,
        encodingRowCount: MAX_DOT_ROW_COUNT + 1,
        encodingColumnAnalysis: numericAnalysis,
        compiledInsight,
      }),
    ).toBe(true);
  });
});

describe("resolveSuggestionDimensionFieldIds", () => {
  it("preserves repeat-join identity in the persisted SelectFields command", () => {
    const fieldId = "11111111-1111-4111-8111-111111111111" as UUID;
    const instanceFieldId = `${fieldId}_j1` as UUID;
    const selectedFields = resolveSuggestionDimensionFieldIds(
      new Map([[fieldIdToColumnAlias(fieldId), fieldId]]),
      [`${fieldIdToColumnAlias(fieldId)}_j1`],
    );
    const insight = {
      id: "22222222-2222-4222-8222-222222222222",
      selectedFields: [],
      metrics: [],
    } as Insight;

    expect(
      buildInsightUpdateCommands(insight.id, insight, { selectedFields }),
    ).toEqual([
      expect.objectContaining({
        path: "selectFields",
        args: expect.objectContaining({ fieldIds: [instanceFieldId] }),
      }),
    ]);
  });
});

describe("buildChartSuggestionInsight", () => {
  it("preserves an Insight-backed source for composed detail views", () => {
    const source = {
      sourceType: "insight" as const,
      sourceId: "insight-upstream",
    };

    expect(
      buildChartSuggestionInsight({
        id: "insight-derived",
        name: "Derived chart",
        source,
        selectedFields: [],
        metrics: [],
        createdAt: 0,
      } as never),
    ).toMatchObject({ source });
  });
});

describe("buildChartSuggestionInsight joined fields", () => {
  it("keeps server-resolved topology while exposing all joined fields", () => {
    const insight = {
      id: "insight-1",
      name: "Saved chart",
      source: { sourceType: "dataTable", sourceId: "table-1" },
      selectedFields: ["field-product"],
      metrics: [{ id: "metric-1", fieldId: "field-quantity", function: "sum" }],
      filters: [
        {
          id: "filter-1",
          fieldId: "field-product",
          operator: "equals",
          value: "A",
        },
      ],
      sorts: [{ fieldId: "field-product", direction: "asc" }],
      joins: [{ id: "join-1", rightTableId: "table-2" }],
      createdAt: 1,
    } as never;

    expect(buildChartSuggestionInsight(insight)).toMatchObject({
      source: { sourceType: "dataTable", sourceId: "table-1" },
      selectedFields: [],
      metrics: [],
      filters: undefined,
      sorts: undefined,
      joins: [{ id: "join-1", rightTableId: "table-2" }],
    });
  });
});

describe("canAttemptVisualizeIntent", () => {
  const ready = {
    visualizeIntent: true,
    alreadyAttempted: false,
    hasVisualization: false,
    hasSuggestion: true,
    hasDataFrame: true,
    isChartViewReady: true,
  };

  it("waits for the saved Insight frame before consuming the intent", () => {
    expect(canAttemptVisualizeIntent(ready)).toBe(true);
    expect(
      canAttemptVisualizeIntent({ ...ready, isChartViewReady: false }),
    ).toBe(false);
    expect(canAttemptVisualizeIntent({ ...ready, hasDataFrame: false })).toBe(
      false,
    );
  });
});

describe("resolveNewChartTarget", () => {
  it("waits for suggestions instead of permanently selecting an unsupported fallback", () => {
    expect(
      resolveNewChartTarget({
        suggestionsReady: false,
      }),
    ).toBeNull();
    expect(
      resolveNewChartTarget({
        suggestionsReady: true,
        firstSuggestedChartType: "line",
      }),
    ).toEqual({ kind: "chart", chartType: "line" });
    expect(
      resolveNewChartTarget({
        suggestionsReady: true,
      }),
    ).toBeNull();
  });

  it("does not carry a queued new-chart request to another insight", () => {
    expect(
      resolvePendingNewChartTarget({
        requestedInsightId: "insight-a",
        currentInsightId: "insight-b",
        suggestionsReady: true,
        firstSuggestedChartType: "line",
      }),
    ).toBeNull();
    expect(
      resolvePendingNewChartTarget({
        requestedInsightId: "insight-a",
        currentInsightId: "insight-a",
        suggestionsReady: true,
        firstSuggestedChartType: "line",
      }),
    ).toEqual({ kind: "chart", chartType: "line" });
  });
});

describe("resolveAddToReportTarget", () => {
  it("does not treat pending or failed dashboard queries as a missing report", () => {
    expect(
      resolveAddToReportTarget({
        reportId: "report-b",
        dashboards: undefined,
        isPending: true,
        isError: false,
      }),
    ).toEqual({ kind: "pending" });
    expect(
      resolveAddToReportTarget({
        reportId: "report-b",
        dashboards: undefined,
        isPending: false,
        isError: true,
      }),
    ).toEqual({ kind: "query-error" });
    expect(
      resolveAddToReportTarget({
        reportId: "report-b",
        dashboards: [{ id: "report-a", items: [] }],
        isPending: false,
        isError: false,
      }),
    ).toEqual({ kind: "missing-report" });
  });
});

describe("InsightView saved-visualization delete confirmation", () => {
  const removeVisualization = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useConfirmDialogStore.getState().close();
    removeVisualization.mockResolvedValue({ ok: true });
  });

  it("does not delete after cancellation, but deletes after confirmation", async () => {
    const user = userEvent.setup();
    render(<ConfirmDialog />);
    act(() => {
      requestSavedVisualizationDeletion(
        useConfirmDialogStore.getState().confirm,
        removeVisualization,
        "viz-1",
        "Revenue by month",
      );
    });

    expect(screen.getByRole("dialog").textContent).toContain(
      'Are you sure you want to delete "Revenue by month"? This deletes only this visualization. Dashboard items that reference it may remain and stop working. This action cannot be undone.',
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(removeVisualization).not.toHaveBeenCalled();

    act(() => {
      requestSavedVisualizationDeletion(
        useConfirmDialogStore.getState().confirm,
        removeVisualization,
        "viz-1",
        "Revenue by month",
      );
    });
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(removeVisualization).toHaveBeenCalledWith({ id: "viz-1" }),
    );
  });

  it("shows one error when deletion rejects", async () => {
    const user = userEvent.setup();
    render(<ConfirmDialog />);
    removeVisualization.mockRejectedValueOnce(new Error("delete failed"));
    act(() => {
      requestSavedVisualizationDeletion(
        useConfirmDialogStore.getState().confirm,
        removeVisualization,
        "viz-1",
        "Revenue by month",
      );
    });

    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledTimes(1);
      expect(mockToastError).toHaveBeenCalledWith(
        "Couldn't delete the visualization",
      );
    });
  });
});
