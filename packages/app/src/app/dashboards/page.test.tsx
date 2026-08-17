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
vi.mock("@wystack/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wystack/client")>();
  return {
    ...actual,
    useQuery: () => mockUseQuery(),
    useMutation: () => ({ mutateAsync: mockCommit }),
  };
});

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
  fireEvent.click(screen.getByRole("button", { name: /new dashboard/i }));
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
    const { api } = await import("@/wystack/api");
    expect(api.commitBatch._path).toBe("commitBatch");
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
    await user.click(screen.getByRole("button", { name: "Delete dashboard" }));

    const dialog = screen.getByRole("dialog", { name: "Delete dashboard" });
    expect(dialog.textContent).toContain(
      'Are you sure you want to delete "Quarterly plan"? This action cannot be undone.',
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockCommit).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete dashboard" }));
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
    await user.click(screen.getByRole("button", { name: "Delete dashboard" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(mockShowError).toHaveBeenCalledWith(
        "Failed to delete dashboard. Please try again.",
      ),
    );
  });
});
