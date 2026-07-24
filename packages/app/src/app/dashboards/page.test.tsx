/**
 * Tests for the DashboardsPage create-dashboard handler.
 *
 * Contracts:
 * - When the create mutation rejects, navigation must NOT occur and the user
 *   must see an error toast. The dialog must remain open.
 * - When the create mutation resolves without an id, navigation must NOT occur
 *   and the user must see an error toast. The dialog must remain open.
 * - On success the dialog closes, the input resets, and navigate is called
 *   with the returned id.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks (vi.mock hoisting requires these to be declared with vi.hoisted)
// ---------------------------------------------------------------------------

const { mockCreate, mockRemove } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockRemove: vi.fn(),
}));

// Partial-mock the WyStack client: keep `createApi` real (so `api` builds real
// refs) and replace the hooks. `useMutation` discriminates by `ref._path` —
// `createApi` caches refs, so the branded path is stable per function.
vi.mock("@wystack/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wystack/client")>();
  return {
    ...actual,
    useQuery: () => ({ data: [], isLoading: false }),
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

vi.mock("@/lib/stores", () => ({
  useToastStore: () => ({ showError: mockShowError }),
}));

// ---------------------------------------------------------------------------
// Import the component after mocks are set up
// ---------------------------------------------------------------------------

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
    expect(mockShowError).not.toHaveBeenCalled();

    // Dialog is closed — the input is no longer in the document
    expect(screen.queryByPlaceholderText(/sales overview/i)).toBeNull();
  });
});
