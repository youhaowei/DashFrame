import {
  nativeQueryMock,
  nativeMutationMock,
  hostQueryMock,
  hostMutationMock,
} from "@/test/native-query-fixture";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const {
  mockClearActiveView,
  mockNavigate,
  mockCommitBatch,
  mockToastError,
  mockUseQuery,
} = vi.hoisted(() => ({
  mockClearActiveView: vi.fn(),
  mockNavigate: vi.fn(),
  mockCommitBatch: vi.fn(),
  mockToastError: vi.fn(),
  mockUseQuery: vi.fn(),
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock((ref: { _path: string }) =>
    mockUseQuery(ref),
  ),
  useMutation: nativeMutationMock(() => ({ mutateAsync: mockCommitBatch })),
}));
vi.mock("@/data/host", () => ({
  useHostQuery: hostQueryMock((ref: { _path: string }) => mockUseQuery(ref)),
  useHostMutation: hostMutationMock(() => ({ mutateAsync: mockCommitBatch })),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mockNavigate }));
vi.mock("@/components/visualizations/CreateVisualizationModal", () => ({
  CreateVisualizationModal: () => null,
}));
vi.mock("@/lib/stores/insight-canvas-store", () => ({
  useInsightCanvasStore: (
    selector: (state: {
      clearActiveView: (insightId: string) => void;
    }) => unknown,
  ) => selector({ clearActiveView: mockClearActiveView }),
}));
vi.mock("sonner", () => ({ toast: { error: mockToastError } }));

import { ConfirmDialog } from "@/components/confirm-dialog";
import { useConfirmDialogStore } from "@/lib/stores";
import InsightsPage from "./page";

const draft = (id: string, name: string) => ({
  id,
  name,
  createdAt: 0,
  source: { sourceType: "dataTable" as const, sourceId: "table-1" },
  selectedFields: [],
  metrics: [],
});

describe("InsightsPage delete confirmations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfirmDialogStore.getState().close();
    mockCommitBatch.mockResolvedValue({ ok: true });
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
    const user = userEvent.setup();
    render(
      <>
        <InsightsPage />
        <ConfirmDialog />
      </>,
    );
    await user.click(
      screen.getAllByRole("button", { name: /more options/i })[0],
    );
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(screen.getByRole("dialog").textContent).toContain(
      'Are you sure you want to delete "First draft"? This deletes the insight and its visualizations. Dashboard items that reference those visualizations may remain and stop working. This action cannot be undone.',
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockCommitBatch).not.toHaveBeenCalled();

    await user.click(
      screen.getAllByRole("button", { name: /more options/i })[0],
    );
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(mockCommitBatch).toHaveBeenCalledWith({
        commands: [{ path: "deleteNode", args: { id: "insight-1" } }],
      });
      expect(mockClearActiveView).toHaveBeenCalledWith("insight-1");
    });
  });

  it("shows root table metadata for a composed Insight", () => {
    const upstream = {
      ...draft("upstream", "Upstream"),
      source: { sourceType: "dataTable" as const, sourceId: "root-table" },
    };
    const composed = {
      ...draft("composed", "Composed report"),
      source: { sourceType: "insight" as const, sourceId: upstream.id },
    };
    mockUseQuery.mockImplementation((ref: { _path: string }) => {
      if (ref._path === "listInsights") {
        return {
          data: [upstream, composed],
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
      if (ref._path === "listDataTables") {
        return {
          data: [
            {
              id: "root-table",
              name: "Root Orders",
              dataSourceId: "source-1",
              fields: [],
              metrics: [],
            },
          ],
        };
      }
      if (ref._path === "listDataSources") {
        return { data: [{ id: "source-1", type: "csv" }] };
      }
      return { data: [] };
    });

    render(<InsightsPage />);

    const card = screen.getByText("Composed report").closest(".group");
    expect(card).not.toBeNull();
    expect(within(card!).getByText("Root Orders • csv")).not.toBeNull();
  });

  it("shows the draft count and does not start the bulk delete until confirmation", async () => {
    const user = userEvent.setup();
    render(
      <>
        <InsightsPage />
        <ConfirmDialog />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Delete all" }));

    expect(
      screen.getByRole("dialog", { name: "Delete drafts" }).textContent,
    ).toContain(
      "Are you sure you want to delete all 2 draft insights? This deletes the drafts and their visualizations. Dashboard items that reference those visualizations may remain and stop working. This action cannot be undone.",
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockCommitBatch).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete all" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(mockCommitBatch).toHaveBeenCalledTimes(2);
      expect(mockCommitBatch).toHaveBeenNthCalledWith(1, {
        commands: [{ path: "deleteNode", args: { id: "insight-1" } }],
      });
      expect(mockCommitBatch).toHaveBeenNthCalledWith(2, {
        commands: [{ path: "deleteNode", args: { id: "insight-2" } }],
      });
      expect(mockClearActiveView).toHaveBeenCalledTimes(2);
      expect(mockClearActiveView).toHaveBeenNthCalledWith(1, "insight-1");
      expect(mockClearActiveView).toHaveBeenNthCalledWith(2, "insight-2");
    });
  });

  it("deletes only matching drafts through the rendered confirmation", async () => {
    const user = userEvent.setup();
    render(
      <>
        <InsightsPage />
        <ConfirmDialog />
      </>,
    );

    await user.type(screen.getByPlaceholderText("Search insights..."), "First");
    expect(screen.getByText("First draft")).not.toBeNull();
    expect(screen.queryByText("Second draft")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Delete matching" }));

    expect(
      screen.getByRole("dialog", { name: "Delete matching drafts" })
        .textContent,
    ).toContain(
      "Are you sure you want to delete 1 matching draft insight? This deletes the matching drafts and their visualizations. Dashboard items that reference those visualizations may remain and stop working. This action cannot be undone.",
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(mockCommitBatch).toHaveBeenCalledTimes(1);
      expect(mockCommitBatch).toHaveBeenCalledWith({
        commands: [{ path: "deleteNode", args: { id: "insight-1" } }],
      });
      expect(mockClearActiveView).toHaveBeenCalledWith("insight-1");
    });
    expect(mockCommitBatch).not.toHaveBeenCalledWith({
      commands: [{ path: "deleteNode", args: { id: "insight-2" } }],
    });
    expect(mockClearActiveView).not.toHaveBeenCalledWith("insight-2");
  });

  it("stops bulk deletion when removing a draft rejects", async () => {
    const user = userEvent.setup();
    mockCommitBatch.mockRejectedValueOnce(new Error("delete failed"));

    render(
      <>
        <InsightsPage />
        <ConfirmDialog />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Delete all" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(mockCommitBatch).toHaveBeenCalledTimes(1);
      expect(mockCommitBatch).toHaveBeenCalledWith({
        commands: [{ path: "deleteNode", args: { id: "insight-1" } }],
      });
      expect(mockClearActiveView).not.toHaveBeenCalled();
      expect(mockToastError).toHaveBeenCalledWith(
        "Couldn't delete every draft — some may remain",
      );
    });
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
        await user.keyboard(activation === "Enter" ? "{Enter}" : "[Space]");
      }

      const deleteItem = await screen.findByRole("menuitem", {
        name: "Delete",
      });
      expect(action.getAttribute("aria-expanded")).toBe("true");
      if (activation !== "pointer") {
        await waitFor(() =>
          expect(document.activeElement).toBe(
            screen.getByRole("menuitem", { name: "Open" }),
          ),
        );
      }
      expect(deleteItem).not.toBeNull();
      expect(mockNavigate).not.toHaveBeenCalled();
    },
  );
});
