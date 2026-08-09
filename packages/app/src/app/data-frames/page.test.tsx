import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseQuery, mockRemoveDataFrame } = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
  mockRemoveDataFrame: vi.fn(),
}));

vi.mock("@wystack/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wystack/client")>();
  return {
    ...actual,
    useQuery: (ref: { _path: string }) => mockUseQuery(ref),
    useMutation: () => ({ mutateAsync: vi.fn() }),
  };
});

vi.mock("@/lib/data-access/data-frames", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data-access/data-frames")>()),
  removeDataFrame: mockRemoveDataFrame,
}));

vi.mock("@/components/data-grid", () => ({
  DataGrid: ({
    data,
    onDelete,
  }: {
    data: Array<{ name: string }>;
    onDelete: (entry: unknown) => void;
  }) => (
    <button onClick={() => onDelete(data[0])}>Delete {data[0].name}</button>
  ),
}));

import { useConfirmDialogStore } from "@/lib/stores";
import DataFramesPage from "./page";

describe("DataFramesPage delete confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfirmDialogStore.getState().close();
    mockUseQuery.mockImplementation((ref: { _path: string }) =>
      ref._path === "listDataFrames"
        ? { data: [{ id: "frame-1", name: "Sales data" }], isLoading: false }
        : { data: [], isLoading: false },
    );
  });

  it("does not remove a data frame after cancellation, but removes it after confirmation", async () => {
    render(<DataFramesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Sales data" }));

    expect(useConfirmDialogStore.getState().config?.description).toBe(
      'Are you sure you want to delete "Sales data"? Data tables that reference it may remain and stop working; dependent insights and visualizations may also stop working. This action cannot be undone.',
    );
    useConfirmDialogStore.getState().handleCancel();
    expect(mockRemoveDataFrame).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete Sales data" }));
    await act(async () => {
      await useConfirmDialogStore.getState().handleConfirm();
    });
    expect(mockRemoveDataFrame).toHaveBeenCalledWith("frame-1");
  });
});
