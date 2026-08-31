import {
  nativeQueryMock,
  nativeMutationMock,
  hostQueryMock,
  hostMutationMock,
} from "@/test/native-query-fixture";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { mockUseQuery, mockRemoveDataFrame } = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
  mockRemoveDataFrame: vi.fn(),
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock((ref: { _path: string }) =>
    mockUseQuery(ref),
  ),
  useMutation: nativeMutationMock(() => ({ mutateAsync: vi.fn() })),
}));
vi.mock("@/data/host", () => ({
  useHostQuery: hostQueryMock((ref: { _path: string }) => mockUseQuery(ref)),
  useHostMutation: hostMutationMock(() => ({ mutateAsync: vi.fn() })),
}));

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

import { ConfirmDialog } from "@/components/confirm-dialog";
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
    const user = userEvent.setup();
    render(
      <>
        <DataFramesPage />
        <ConfirmDialog />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Delete Sales data" }));

    expect(screen.getByRole("dialog").textContent).toContain(
      'Are you sure you want to delete "Sales data"? Data tables that reference it may remain and stop working; dependent insights and visualizations may also stop working. This action cannot be undone.',
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockRemoveDataFrame).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete Sales data" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(mockRemoveDataFrame).toHaveBeenCalledWith("frame-1"),
    );
  });
});
