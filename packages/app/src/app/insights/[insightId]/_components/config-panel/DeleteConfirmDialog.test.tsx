import type { Visualization } from "@dashframe/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  type AffectedVisualization,
  DeleteConfirmDialog,
  type UsageStatus,
} from "./DeleteConfirmDialog";

function renderDialog(
  usageStatus: UsageStatus,
  affectedVisualizations: AffectedVisualization[] = [],
) {
  const onDelete = vi.fn();
  render(
    <DeleteConfirmDialog
      isOpen
      itemName="Region"
      itemType="field"
      affectedVisualizations={affectedVisualizations}
      usageStatus={usageStatus}
      processingVizId={null}
      onClose={vi.fn()}
      onRemoveFromVisualization={vi.fn()}
      onDeleteVisualization={vi.fn()}
      onDelete={onDelete}
    />,
  );
  const deleteButton = screen.getByRole("button", {
    name: /delete field/i,
  }) as HTMLButtonElement;
  return { deleteButton, onDelete };
}

describe("DeleteConfirmDialog", () => {
  it.each<[UsageStatus, RegExp]>([
    ["loading", /checking which charts use/i],
    ["error", /couldn't check which charts use/i],
  ])("blocks deleting while chart usage is %s", (usageStatus, description) => {
    const { deleteButton, onDelete } = renderDialog(usageStatus);
    expect(screen.getByText(description)).toBeTruthy();
    expect(deleteButton.disabled).toBe(true);
    fireEvent.click(deleteButton);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("deletes once no loaded chart uses the item", () => {
    const { deleteButton, onDelete } = renderDialog("known");
    expect(deleteButton.disabled).toBe(false);
    fireEvent.click(deleteButton);
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("blocks deleting while a loaded chart still uses the item", () => {
    const chart = { id: "chart", name: "Sales" } as Visualization;
    const { deleteButton } = renderDialog("known", [
      { visualization: chart, affectedChannels: ["x"] },
    ]);
    expect(deleteButton.disabled).toBe(true);
  });
});
