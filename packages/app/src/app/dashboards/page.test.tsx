/**
 * Tests for the DashboardsPage create-dashboard handler.
 *
 * Contracts:
 * - When the create mutation rejects, navigation must NOT occur and the user
 *   must see an error toast. The dialog must remain open.
 * - When the create mutation resolves without an id, navigation must NOT occur
 *   and the user must see an error toast. The dialog must remain open.
 * - On success the dialog closes, the input resets, navigate is called with
 *   the returned id, and create receives the reshaped `{ name }` arg object.
 * - The registry mints bare-name branded paths, so the partial-mock's
 *   `ref._path` discrimination stays valid (guards the fan-out template).
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

const { mockCreate, mockRemove, mockUseQuery } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockRemove: vi.fn(),
  mockUseQuery: vi.fn(),
}));

// Partial-mock the WyStack client: keep `createApi` real (so `api` builds real
// refs) and replace the hooks. `useMutation` discriminates by `ref._path` —
// `createApi` caches refs, so the branded path is stable per function.
vi.mock("@wystack/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wystack/client")>();
  return {
    ...actual,
    useQuery: () => mockUseQuery(),
    useMutation: (ref: { _path: string }) =>
      ref._path === "removeDashboard"
        ? { mutateAsync: mockRemove }
        : { mutateAsync: mockCreate },
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
    useConfirmDialogStore.getState().close();
    mockUseQuery.mockReturnValue({ data: [], isLoading: false });
  });

  it("shows error toast and does NOT navigate when createDashboard rejects", async () => {
    mockCreate.mockRejectedValue(new Error("network error"));

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

  it("shows error toast and does NOT navigate when the create mutation resolves without an id", async () => {
    mockCreate.mockResolvedValue({ id: undefined });

    render(<DashboardsPage />);
    openCreateDialog();
    typeName("Another Board");
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
    mockCreate.mockResolvedValue({ id: "dash-abc" });

    render(<DashboardsPage />);
    openCreateDialog();
    typeName("Success Board");
    await act(async () => {
      await submitCreate();
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/dashboards/dash-abc" });
    });
    // Assert the reshaped registry-object arg, not just that create fired —
    // a dropped/misnamed key (`title` vs `name`) must fail here.
    expect(mockCreate).toHaveBeenCalledWith({ name: "Success Board" });
    expect(mockShowError).not.toHaveBeenCalled();

    // Dialog is closed — the input is no longer in the document
    expect(screen.queryByPlaceholderText(/sales overview/i)).toBeNull();
  });

  it("mints bare-name branded paths the mock discriminates on", async () => {
    // The partial-mock routes useMutation by ref._path. This guards the
    // invariant that keeps that routing valid: the registry mints bare
    // function names, so a future dotted/namespaced path would fail loudly
    // here instead of silently aliasing every mutation to mockCreate.
    const { api } = await import("@/wystack/api");
    expect(api.createDashboard._path).toBe("createDashboard");
    expect(api.removeDashboard._path).toBe("removeDashboard");
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
    mockRemove.mockResolvedValue({ ok: true });

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
    expect(mockRemove).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete dashboard" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(mockRemove).toHaveBeenCalledWith({ id: "dashboard-1" }),
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
    mockRemove.mockRejectedValueOnce(new Error("delete failed"));

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
