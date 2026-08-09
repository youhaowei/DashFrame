import { useConfirmDialogStore } from "@/lib/stores/confirm-dialog-store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockToastError } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
}));

vi.mock("@dashframe/engine-browser", () => ({
  analyzeView: vi.fn(),
  ensureTableLoaded: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: mockToastError } }));

import { requestSavedVisualizationDeletion } from "./InsightView";

describe("InsightView saved-visualization delete confirmation", () => {
  const removeVisualization = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useConfirmDialogStore.getState().close();
    removeVisualization.mockResolvedValue({ ok: true });
  });

  it("does not delete after cancellation, but deletes after confirmation", async () => {
    requestSavedVisualizationDeletion(
      useConfirmDialogStore.getState().confirm,
      removeVisualization,
      "viz-1",
      "Revenue by month",
    );

    expect(useConfirmDialogStore.getState().config?.description).toBe(
      'Are you sure you want to delete "Revenue by month"? This deletes only this visualization. Dashboard items that reference it may remain and stop working. This action cannot be undone.',
    );

    useConfirmDialogStore.getState().handleCancel();
    expect(removeVisualization).not.toHaveBeenCalled();

    requestSavedVisualizationDeletion(
      useConfirmDialogStore.getState().confirm,
      removeVisualization,
      "viz-1",
      "Revenue by month",
    );
    await useConfirmDialogStore.getState().handleConfirm();

    expect(removeVisualization).toHaveBeenCalledWith({ id: "viz-1" });
  });

  it("shows one error when deletion rejects", async () => {
    removeVisualization.mockRejectedValueOnce(new Error("delete failed"));
    requestSavedVisualizationDeletion(
      useConfirmDialogStore.getState().confirm,
      removeVisualization,
      "viz-1",
      "Revenue by month",
    );

    await useConfirmDialogStore.getState().handleConfirm();

    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith(
      "Couldn't delete the visualization",
    );
  });
});
