import {
  nativeQueryMock,
  nativeMutationMock,
  hostQueryMock,
  hostMutationMock,
} from "@/test/native-query-fixture";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { mockCommitBatch, mockNavigate, mockUseQuery } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockCommitBatch: vi.fn(),
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

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    className,
  }: {
    children: React.ReactNode;
    to: string;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useNavigate: () => mockNavigate,
}));

vi.mock("@/components/visualizations/CreateVisualizationModal", () => ({
  CreateVisualizationModal: () => null,
}));

import { ConfirmDialog } from "@/components/confirm-dialog";
import { useConfirmDialogStore } from "@/lib/stores";
import VisualizationsPage from "./page";

describe("VisualizationsPage delete confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfirmDialogStore.getState().close();
    mockCommitBatch.mockResolvedValue({ ok: true });
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
    const user = userEvent.setup();
    render(
      <>
        <VisualizationsPage />
        <ConfirmDialog />
      </>,
    );
    await user.click(screen.getByRole("button", { name: /more options/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    expect(screen.getByRole("dialog").textContent).toContain(
      'Are you sure you want to delete "Revenue by month"? This deletes only this visualization. Dashboard items that reference it may remain and stop working. This action cannot be undone.',
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockCommitBatch).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /more options/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(mockCommitBatch).toHaveBeenCalledWith({
        commands: [{ path: "deleteNode", args: { id: "viz-1" } }],
      }),
    );
  });

  it("shows root source metadata for a visualization of a composed Insight", () => {
    mockUseQuery.mockImplementation((ref: { _path: string }) => {
      if (ref._path === "listVisualizations") {
        return {
          data: [
            {
              id: "viz-1",
              name: "Revenue by month",
              insightId: "composed",
              visualizationType: "bar",
              encoding: {},
            },
          ],
          isLoading: false,
        };
      }
      if (ref._path === "listInsights") {
        return {
          data: [
            {
              id: "upstream",
              name: "Upstream",
              source: {
                sourceType: "dataTable",
                sourceId: "root-table",
              },
              selectedFields: [],
              metrics: [],
              createdAt: 0,
            },
            {
              id: "composed",
              name: "Composed report",
              source: { sourceType: "insight", sourceId: "upstream" },
              selectedFields: [],
              metrics: [],
              createdAt: 0,
            },
          ],
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
      return { data: [], isLoading: false };
    });

    render(<VisualizationsPage />);

    const link = screen.getByRole("link", {
      name: /Revenue by month.*From: Composed report.*csv/,
    });
    expect(link.getAttribute("href")).toBe("/visualizations/viz-1");
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
