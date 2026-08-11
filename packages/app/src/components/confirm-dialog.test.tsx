import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

  it("confirms exactly once when Confirm is clicked", async () => {
    const onConfirm = vi.fn();
    useConfirmDialogStore.getState().confirm({
      title: "Delete item",
      description: "This action cannot be undone.",
      onConfirm,
    });

    render(<ConfirmDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });

  it("closes and contains a rejected confirmation", async () => {
    const error = new Error("Delete failed");
    const onConfirm = vi.fn().mockRejectedValue(error);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    useConfirmDialogStore.getState().confirm({
      title: "Delete item",
      description: "This action cannot be undone.",
      onConfirm,
    });

    render(<ConfirmDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        "Confirm dialog action failed:",
        error,
      );
    });
    expect(useConfirmDialogStore.getState().isOpen).toBe(false);
    expect(useConfirmDialogStore.getState().config).toBeNull();
  });
});
