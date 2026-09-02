import {
  nativeQueryMock,
  nativeMutationMock,
  hostQueryMock,
  hostMutationMock,
} from "@/test/native-query-fixture";
import { getFunctionName } from "convex/server";
/**
 * Tests for the DashboardsPage create-dashboard handler.
 *
 * Contracts:
 * - When the create mutation rejects, navigation must NOT occur and the user
 *   must see an error toast. The dialog must remain open.
 * - On success the dialog closes, the input resets, navigate is called with
 *   the client-minted id, and commitBatch receives CreateDashboard.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

// ---------------------------------------------------------------------------
// Hoisted mocks (vi.mock hoisting requires these to be declared with vi.hoisted)
// ---------------------------------------------------------------------------

const { mockCommit, mockUseQuery } = vi.hoisted(() => ({
  mockCommit: vi.fn(),
  mockUseQuery: vi.fn(),
}));

// Partial-mock the WyStack client: keep `createApi` real (so `api` builds real
// refs) and replace the hooks.
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock((ref: { _path: string }) =>
    mockUseQuery(ref),
  ),
  useMutation: nativeMutationMock(() => ({ mutateAsync: mockCommit })),
}));
vi.mock("@/data/host", () => ({
  useHostQuery: hostQueryMock(() => mockUseQuery()),
  useHostMutation: hostMutationMock(() => ({ mutateAsync: mockCommit })),
}));

const { mockNavigate } = vi.hoisted(() => {
  const navigate = vi.fn();
  return { mockNavigate: navigate };
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

const { mockShowError } = vi.hoisted(() => {
  const showError = vi.fn();
  return { mockShowError: showError };
});

vi.mock("@/lib/stores", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stores")>()),
  useToastStore: () => ({ showError: mockShowError }),
}));

// ---------------------------------------------------------------------------
// Import the component after mocks are set up
// ---------------------------------------------------------------------------

import { ConfirmDialog } from "@/components/confirm-dialog";
import { useConfirmDialogStore } from "@/lib/stores";
import DashboardsPage from "./page";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function openCreateDialog() {
  fireEvent.click(screen.getByRole("button", { name: /new report/i }));
}

function typeName(name: string) {
  const input = screen.getByPlaceholderText(/sales overview/i);
  fireEvent.change(input, { target: { value: name } });
}

async function submitCreate() {
  fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DashboardsPage – handleCreate failure paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    useConfirmDialogStore.getState().close();
    mockUseQuery.mockReturnValue({ data: [], isLoading: false });
  });

  it("shows error toast and does NOT navigate when createDashboard rejects", async () => {
    mockCommit.mockRejectedValue(new Error("network error"));

    render(<DashboardsPage />);
    openCreateDialog();
    typeName("My Board");
    await act(async () => {
      await submitCreate();
    });

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledTimes(1);
    });
    expect(mockNavigate).not.toHaveBeenCalled();

    // Dialog remains open — getByPlaceholderText throws if the element is absent
    screen.getByPlaceholderText(/sales overview/i);
  });

  it("navigates to the dashboard and closes the dialog on success", async () => {
    mockCommit.mockResolvedValue({ results: [] });

    render(<DashboardsPage />);
    openCreateDialog();
    typeName("Success Board");
    await act(async () => {
      await submitCreate();
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/dashboards/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      });
    });
    expect(mockCommit).toHaveBeenCalledWith({
      commands: [
        {
          path: "createDashboardCmd",
          args: {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            name: "Success Board",
          },
        },
      ],
    });
    expect(mockShowError).not.toHaveBeenCalled();

    // Dialog is closed — the input is no longer in the document
    expect(screen.queryByPlaceholderText(/sales overview/i)).toBeNull();
  });

  it("uses the commitBatch registry path", async () => {
    const { api } = await import("@dashframe/convex-backend/api");
    expect(getFunctionName(api.app.commitBatch)).toBe("app:commitBatch");
  });
});

describe("DashboardsPage – delete confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfirmDialogStore.getState().close();
    mockUseQuery.mockReturnValue({ data: [], isLoading: false });
  });

  it("does not remove a dashboard after cancellation, but removes it after confirmation", async () => {
    const user = userEvent.setup();
    mockUseQuery.mockReturnValue({
      data: [
        {
          id: "dashboard-1",
          name: "Quarterly plan",
          items: [],
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      isLoading: false,
    });
    mockCommit.mockResolvedValue({ results: [] });

    render(
      <>
        <DashboardsPage />
        <ConfirmDialog />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "More options" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    const dialog = screen.getByRole("dialog", { name: "Delete report" });
    expect(dialog.textContent).toContain(
      'Are you sure you want to delete "Quarterly plan"? This action cannot be undone.',
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockCommit).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "More options" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(mockCommit).toHaveBeenCalledWith({
        commands: [{ path: "deleteNode", args: { id: "dashboard-1" } }],
      }),
    );
  });

  it("shows an error toast when confirmed deletion rejects", async () => {
    const user = userEvent.setup();
    mockUseQuery.mockReturnValue({
      data: [
        {
          id: "dashboard-1",
          name: "Quarterly plan",
          items: [],
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      isLoading: false,
    });
    mockCommit.mockRejectedValueOnce(new Error("delete failed"));

    render(
      <>
        <DashboardsPage />
        <ConfirmDialog />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "More options" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(mockShowError).toHaveBeenCalledWith(
        "Failed to delete report. Please try again.",
      ),
    );
  });

  it("filters dashboards by name and clears the search", async () => {
    const user = userEvent.setup();
    mockUseQuery.mockReturnValue({
      data: [
        {
          id: "dashboard-1",
          name: "Quarterly plan",
          items: [],
          createdAt: 0,
          updatedAt: 0,
        },
        {
          id: "dashboard-2",
          name: "Customer overview",
          items: [],
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      isLoading: false,
    });

    render(<DashboardsPage />);

    await user.type(
      screen.getByPlaceholderText("Search reports..."),
      "Quarter",
    );
    expect(screen.getByText("Quarterly plan")).not.toBeNull();
    expect(screen.queryByText("Customer overview")).toBeNull();

    await user.clear(screen.getByPlaceholderText("Search reports..."));
    await user.type(
      screen.getByPlaceholderText("Search reports..."),
      "Missing",
    );
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByText("Quarterly plan")).not.toBeNull();
    expect(screen.getByText("Customer overview")).not.toBeNull();
  });

  it("shows unique question and saved-view counts and links to Questions", async () => {
    const user = userEvent.setup();
    mockUseQuery.mockImplementation((ref: { _path: string }) => {
      if (ref._path === "listDashboards") {
        return {
          data: [
            {
              id: "dashboard-1",
              name: "Quarterly plan",
              items: [
                { type: "visualization", visualizationId: "view-1" },
                { type: "visualization", visualizationId: "view-1" },
                { type: "visualization", visualizationId: "view-2" },
              ],
              createdAt: 0,
              updatedAt: 0,
            },
          ],
          isLoading: false,
        };
      }
      if (ref._path === "listVisualizations") {
        return {
          data: [
            { id: "view-1", insightId: "question-1" },
            { id: "view-2", insightId: "question-2" },
          ],
          isLoading: false,
        };
      }
      return { data: [], isLoading: false };
    });

    render(<DashboardsPage />);

    expect(
      screen.getByRole("link", {
        name: /Quarterly plan 2 questions 2 saved views/,
      }),
    ).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Questions" }));
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/insights" });
  });

  it.each(["pointer", "Enter", "Space"] as const)(
    "opens the card menu with %s without navigating the card",
    async (activation) => {
      const user = userEvent.setup();
      mockUseQuery.mockReturnValue({
        data: [
          {
            id: "dashboard-1",
            name: "Quarterly plan",
            items: [],
            createdAt: 0,
            updatedAt: 0,
          },
        ],
        isLoading: false,
      });

      render(<DashboardsPage />);

      const action = screen.getByRole("button", { name: "More options" });
      if (activation === "pointer") {
        await user.click(action);
      } else {
        action.focus();
        await user.keyboard(activation === "Enter" ? "{Enter}" : "[Space]");
      }

      expect(
        await screen.findByRole("menuitem", { name: "Open" }),
      ).not.toBeNull();
      expect(screen.getByRole("menuitem", { name: "Delete" })).not.toBeNull();
      expect(mockNavigate).not.toHaveBeenCalled();
    },
  );
});
