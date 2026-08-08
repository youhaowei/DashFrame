import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRemoveInsight, mockUseQuery } = vi.hoisted(() => ({
  mockRemoveInsight: vi.fn(),
  mockUseQuery: vi.fn(),
}));

vi.mock("@wystack/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wystack/client")>();
  return {
    ...actual,
    useQuery: (ref: { _path: string }) => mockUseQuery(ref),
    useMutation: () => ({ mutateAsync: mockRemoveInsight }),
  };
});

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/components/visualizations/CreateVisualizationModal", () => ({
  CreateVisualizationModal: () => null,
}));
vi.mock("@/lib/stores/insight-canvas-store", () => ({
  useInsightCanvasStore: (
    selector: (state: { clearActiveView: () => void }) => unknown,
  ) => selector({ clearActiveView: vi.fn() }),
}));

import { useConfirmDialogStore } from "@/lib/stores";
import InsightsPage from "./page";

const draft = (id: string, name: string) => ({
  id,
  name,
  createdAt: 0,
  selectedFields: [],
  metrics: [],
});

describe("InsightsPage delete confirmations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfirmDialogStore.getState().close();
    mockRemoveInsight.mockResolvedValue({ ok: true });
    mockUseQuery.mockImplementation((ref: { _path: string }) => {
      if (ref._path === "listInsights") {
        return {
          data: [
            draft("insight-1", "First draft"),
            draft("insight-2", "Second draft"),
          ],
          isPending: false,
          isLoadingError: false,
          refetch: vi.fn(),
        };
      }
      if (ref._path === "listVisualizations") {
        return {
          data: [],
          isPending: false,
          isLoadingError: false,
          refetch: vi.fn(),
        };
      }
      return { data: [] };
    });
  });

  it("does not delete one draft after cancellation, but deletes it after confirmation", async () => {
    render(<InsightsPage />);
    fireEvent.click(
      screen.getAllByRole("button", { name: /more options/i })[0],
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    useConfirmDialogStore.getState().handleCancel();
    expect(mockRemoveInsight).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getAllByRole("button", { name: /more options/i })[0],
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    useConfirmDialogStore.getState().handleConfirm();
    expect(mockRemoveInsight).toHaveBeenCalledWith({ id: "insight-1" });
  });

  it("shows the draft count and does not start the bulk delete until confirmation", () => {
    render(<InsightsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Delete all" }));

    expect(useConfirmDialogStore.getState().config?.description).toContain(
      "2 draft insights",
    );
    useConfirmDialogStore.getState().handleCancel();
    expect(mockRemoveInsight).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete all" }));
    useConfirmDialogStore.getState().handleConfirm();
    expect(mockRemoveInsight).toHaveBeenCalledWith({ id: "insight-1" });
  });
});
