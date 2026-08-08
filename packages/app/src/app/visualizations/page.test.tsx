import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRemoveVisualization, mockUseQuery } = vi.hoisted(() => ({
  mockRemoveVisualization: vi.fn(),
  mockUseQuery: vi.fn(),
}));

vi.mock("@wystack/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wystack/client")>();
  return {
    ...actual,
    useQuery: (ref: { _path: string }) => mockUseQuery(ref),
    useMutation: () => ({ mutateAsync: mockRemoveVisualization }),
  };
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/components/visualizations/CreateVisualizationModal", () => ({
  CreateVisualizationModal: () => null,
}));

import { useConfirmDialogStore } from "@/lib/stores";
import VisualizationsPage from "./page";

describe("VisualizationsPage delete confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfirmDialogStore.getState().close();
    mockRemoveVisualization.mockResolvedValue({ ok: true });
    mockUseQuery.mockImplementation((ref: { _path: string }) => {
      if (ref._path === "listVisualizations") {
        return {
          data: [
            {
              id: "viz-1",
              name: "Revenue by month",
              visualizationType: "bar",
              encoding: {},
            },
          ],
          isLoading: false,
        };
      }
      return { data: [], isLoading: false };
    });
  });

  it("does not remove a visualization after cancellation, but removes it after confirmation", async () => {
    render(<VisualizationsPage />);
    fireEvent.click(screen.getByRole("button", { name: /more options/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));

    expect(useConfirmDialogStore.getState().config?.description).toBe(
      'Are you sure you want to delete "Revenue by month"? This action cannot be undone.',
    );
    useConfirmDialogStore.getState().handleCancel();
    expect(mockRemoveVisualization).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /more options/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    useConfirmDialogStore.getState().handleConfirm();

    expect(mockRemoveVisualization).toHaveBeenCalledWith({ id: "viz-1" });
  });
});
