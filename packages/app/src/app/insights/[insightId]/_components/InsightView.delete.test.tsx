import { useConfirmDialogStore } from "@/lib/stores/confirm-dialog-store";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockToastError } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: mockToastError } }));

import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  buildChartSuggestionInsight,
  canAttemptVisualizeIntent,
  requestSavedVisualizationDeletion,
  resolveVisualModeTarget,
} from "./InsightView";

describe("buildChartSuggestionInsight", () => {
  it("keeps server-resolved topology while exposing all joined fields", () => {
    const insight = {
      id: "insight-1",
      name: "Saved chart",
      baseTableId: "table-1",
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
      baseTableId: "table-1",
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

describe("resolveVisualModeTarget", () => {
  it("waits for suggestions instead of permanently selecting an unsupported fallback", () => {
    expect(
      resolveVisualModeTarget({
        suggestionsReady: false,
      }),
    ).toBeNull();
    expect(
      resolveVisualModeTarget({
        suggestionsReady: true,
        firstSuggestedChartType: "line",
      }),
    ).toEqual({ kind: "chart", chartType: "line" });
  });

  it("opens an existing saved visualization without waiting for suggestions", () => {
    expect(
      resolveVisualModeTarget({
        firstPinnedVisualizationId: "visualization-1",
        suggestionsReady: false,
      }),
    ).toEqual({
      kind: "visualization",
      visualizationId: "visualization-1",
    });
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
