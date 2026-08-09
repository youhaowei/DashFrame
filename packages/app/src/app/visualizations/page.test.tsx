import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockNavigate, mockRemoveVisualization, mockUseQuery } = vi.hoisted(
  () => ({
    mockNavigate: vi.fn(),
    mockRemoveVisualization: vi.fn(),
    mockUseQuery: vi.fn(),
  }),
);

vi.mock("@wystack/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wystack/client")>();
  return {
    ...actual,
    useQuery: (ref: { _path: string }) => mockUseQuery(ref),
    useMutation: () => ({ mutateAsync: mockRemoveVisualization }),
  };
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
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
      'Are you sure you want to delete "Revenue by month"? This deletes only this visualization. Dashboard items that reference it may remain and stop working. This action cannot be undone.',
    );
    useConfirmDialogStore.getState().handleCancel();
    expect(mockRemoveVisualization).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /more options/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    useConfirmDialogStore.getState().handleConfirm();

    expect(mockRemoveVisualization).toHaveBeenCalledWith({ id: "viz-1" });
  });

  it.each(["pointer", "Enter", "Space"] as const)(
    "opens a card menu with %s without navigating the card",
    async (activation) => {
      const user = userEvent.setup();

      render(<VisualizationsPage />);

      const action = screen.getByRole("button", { name: "More options" });
      if (activation === "pointer") {
        await user.click(action);
      } else {
        action.focus();
        await user.keyboard(activation === "Enter" ? "{Enter}" : "[Space]");
      }

      const deleteItem = await screen.findByRole("menuitem", {
        name: "Delete",
      });
      expect(action.getAttribute("aria-expanded")).toBe("true");
      if (activation !== "pointer") {
        expect(document.activeElement).toBe(
          screen.getByRole("menuitem", { name: "Open" }),
        );
      }
      expect(deleteItem).not.toBeNull();
      expect(mockNavigate).not.toHaveBeenCalled();
    },
  );
});
