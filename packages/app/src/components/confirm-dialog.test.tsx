import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useConfirmDialogStore } from "@/lib/stores/confirm-dialog-store";
import { ConfirmDialog } from "./confirm-dialog";

describe("ConfirmDialog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useConfirmDialogStore.getState().close();
  });

  it("closes without confirming when Cancel is clicked", () => {
    const onConfirm = vi.fn();
    useConfirmDialogStore.getState().confirm({
      title: "Delete item",
      description: "This action cannot be undone.",
      onConfirm,
    });

    render(<ConfirmDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(useConfirmDialogStore.getState().isOpen).toBe(false);
    expect(useConfirmDialogStore.getState().config).toBeNull();
  });
});
