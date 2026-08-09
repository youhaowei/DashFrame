import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockNavigate, mockRemoveInsight, mockUseQuery } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
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

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mockNavigate }));
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
    expect(useConfirmDialogStore.getState().config?.description).toBe(
      'Are you sure you want to delete "First draft"? This deletes the insight and its visualizations. Dashboard items that reference those visualizations may remain and stop working. This action cannot be undone.',
    );
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

    expect(useConfirmDialogStore.getState().config?.description).toBe(
      "Are you sure you want to delete all 2 draft insights? This deletes the drafts and their visualizations. Dashboard items that reference those visualizations may remain and stop working. This action cannot be undone.",
    );
    useConfirmDialogStore.getState().handleCancel();
    expect(mockRemoveInsight).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete all" }));
    useConfirmDialogStore.getState().handleConfirm();
    expect(mockRemoveInsight).toHaveBeenCalledWith({ id: "insight-1" });
  });

  it.each(["pointer", "Enter", "Space"] as const)(
    "opens a card menu with %s without navigating the card",
    async (activation) => {
      const user = userEvent.setup();

      render(<InsightsPage />);

      const action = screen.getAllByRole("button", {
        name: "More options",
      })[0];
      if (activation === "pointer") {
        await user.click(action);
      } else {
        action.focus();
        await user.keyboard(activation === "Enter" ? "{Enter>}" : "[Space>]");
      }

      expect(
        await screen.findByRole("menuitem", { name: "Delete" }),
      ).not.toBeNull();
      expect(mockNavigate).not.toHaveBeenCalled();

      if (activation !== "pointer") {
        await user.keyboard(activation === "Enter" ? "{Enter/}" : "[Space/]");
      }
    },
  );
});
