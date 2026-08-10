import type { Field, UUID } from "@dashframe/types";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  reviewUnclassifiedRemoteFields,
  type RemoteFieldReviewRequest,
} from "@/lib/remote-field-review";
import { useConfirmDialogStore } from "@/lib/stores/confirm-dialog-store";
import { ConfirmDialog } from "./confirm-dialog";

const TABLE_ID = "11111111-1111-4111-8111-111111111111" as UUID;

function unclassifiedField(id: UUID, name: string): Field {
  return {
    id,
    tableId: TABLE_ID,
    name,
    columnName: name,
    type: "string",
  };
}

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

  it("hands focus to each sequential promise-backed review dialog", async () => {
    const user = userEvent.setup();
    const fields = [
      unclassifiedField(
        "22222222-2222-4222-8222-222222222222" as UUID,
        "Email",
      ),
      unclassifiedField(
        "33333333-3333-4333-8333-333333333333" as UUID,
        "Phone",
      ),
    ];
    const requestReview = ({
      field,
      position,
      total,
    }: RemoteFieldReviewRequest) =>
      new Promise<boolean>((resolve) => {
        useConfirmDialogStore.getState().confirm({
          title: `Review ${field.name}`,
          description: `Field ${position} of ${total}`,
          confirmLabel: "Mark safe",
          onConfirm: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });

    render(<ConfirmDialog />);
    let reviewResult: Promise<Field[] | null>;
    act(() => {
      reviewResult = reviewUnclassifiedRemoteFields(fields, requestReview);
    });

    expect(screen.getByRole("dialog", { name: "Review Email" })).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Mark safe" }));

    const secondDialog = await screen.findByRole("dialog", {
      name: "Review Phone",
    });
    expect(secondDialog.textContent).toContain("Field 2 of 2");
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Cancel" }),
      ),
    );

    await user.click(screen.getByRole("button", { name: "Mark safe" }));
    if (!reviewResult) throw new Error("Review did not start");
    await expect(reviewResult).resolves.toEqual([
      expect.objectContaining({ name: "Email", sensitivity: "cleared" }),
      expect.objectContaining({ name: "Phone", sensitivity: "cleared" }),
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
