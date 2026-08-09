import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockNavigate,
  mockRefetchDataSources,
  mockRefetchDataTables,
  mockRemoveDataSource,
  mockUseDataSources,
  mockUseDataTables,
  mockToastError,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockRefetchDataSources: vi.fn(),
  mockRefetchDataTables: vi.fn(),
  mockRemoveDataSource: vi.fn(),
  mockUseDataSources: vi.fn(),
  mockUseDataTables: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("@wystack/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wystack/client")>();
  return {
    ...actual,
    useQuery: (ref: { _path: string }) => {
      if (ref._path === "listDataSources") return mockUseDataSources();
      if (ref._path === "listDataTables") return mockUseDataTables();
      throw new Error(`Unexpected query: ${ref._path}`);
    },
    useMutation: (ref: { _path: string }) => {
      if (ref._path === "removeDataSource") {
        return { mutateAsync: mockRemoveDataSource };
      }
      throw new Error(`Unexpected mutation: ${ref._path}`);
    },
  };
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/components/visualizations/CreateVisualizationModal", () => ({
  CreateVisualizationModal: () => null,
}));

vi.mock("sonner", () => ({ toast: { error: mockToastError } }));

import { ConfirmDialog } from "@/components/confirm-dialog";
import { useConfirmDialogStore } from "@/lib/stores";
import DataSourcesPage from "./page";

function successfulQuery(refetch: () => Promise<unknown>) {
  return {
    data: [],
    error: null,
    isError: false,
    isLoading: false,
    refetch,
  };
}

describe("DataSourcesPage query states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfirmDialogStore.getState().close();
    mockRefetchDataSources.mockResolvedValue(undefined);
    mockRefetchDataTables.mockResolvedValue(undefined);
    mockRemoveDataSource.mockResolvedValue({ ok: true });
    mockUseDataSources.mockReturnValue(successfulQuery(mockRefetchDataSources));
    mockUseDataTables.mockReturnValue(successfulQuery(mockRefetchDataTables));
  });

  it.each(["data sources", "data tables"])(
    "renders a retryable error instead of an empty state when fetching %s fails",
    async (failedQuery) => {
      const failure = {
        data: undefined,
        error: new Error("service unavailable"),
        isError: true,
        isLoading: false,
      };
      if (failedQuery === "data sources") {
        mockUseDataSources.mockReturnValue({
          ...failure,
          refetch: mockRefetchDataSources,
        });
      } else {
        mockUseDataTables.mockReturnValue({
          ...failure,
          refetch: mockRefetchDataTables,
        });
      }

      render(<DataSourcesPage />);

      expect(screen.getByRole("alert")).not.toBeNull();
      expect(screen.getByText("Failed to load data sources")).not.toBeNull();
      expect(screen.queryByText("No data sources yet")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: /retry/i }));
      await waitFor(() => {
        expect(mockRefetchDataSources).toHaveBeenCalledTimes(1);
        expect(mockRefetchDataTables).toHaveBeenCalledTimes(1);
      });
    },
  );

  it("renders the real empty state after both queries succeed", () => {
    render(<DataSourcesPage />);

    expect(screen.getByText("No data sources yet")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each(["pointer", "keyboard"] as const)(
    "opens a card menu with %s without navigating the card",
    async (activation) => {
      mockUseDataSources.mockReturnValue({
        ...successfulQuery(mockRefetchDataSources),
        data: [
          {
            id: "source-123",
            name: "Local Files",
            type: "local",
            config: { hasApiKey: false, hasConnectionString: false },
            createdAt: 0,
          },
        ],
      });
      const user = userEvent.setup();

      render(<DataSourcesPage />);

      const action = screen.getByRole("button", { name: "More options" });
      if (activation === "pointer") {
        await user.click(action);
      } else {
        action.focus();
        await user.keyboard("{Enter}");
      }

      expect(
        await screen.findByRole("menuitem", { name: "Delete" }),
      ).not.toBeNull();
      expect(mockNavigate).not.toHaveBeenCalled();
    },
  );

  it("does not remove a data source until the rendered confirmation is accepted", async () => {
    mockUseDataSources.mockReturnValue({
      ...successfulQuery(mockRefetchDataSources),
      data: [
        {
          id: "source-123",
          name: "Local Files",
          type: "local",
          config: { hasApiKey: false, hasConnectionString: false },
          createdAt: 0,
        },
      ],
    });

    render(
      <>
        <DataSourcesPage />
        <ConfirmDialog />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /delete/i }));

    const dialog = await screen.findByRole("dialog", {
      name: "Delete data source",
    });
    expect(dialog.textContent).toContain(
      'Are you sure you want to delete "Local Files"? This deletes the data source and its data tables. Related DataFrame metadata and storage, and dependent insights, may remain. This action cannot be undone.',
    );
    expect(mockRemoveDataSource).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockRemoveDataSource).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /delete/i }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(mockRemoveDataSource).toHaveBeenCalledWith({ id: "source-123" });
    });
  });

  it("shows a failure toast when confirmed deletion rejects", async () => {
    mockRemoveDataSource.mockRejectedValueOnce(new Error("delete failed"));
    mockUseDataSources.mockReturnValue({
      ...successfulQuery(mockRefetchDataSources),
      data: [
        {
          id: "source-123",
          name: "Local Files",
          type: "local",
          config: { hasApiKey: false, hasConnectionString: false },
          createdAt: 0,
        },
      ],
    });

    render(
      <>
        <DataSourcesPage />
        <ConfirmDialog />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /delete/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        "Failed to delete data source",
      );
    });
  });

  it("opts the more-options action into the group focus-within reveal", () => {
    mockUseDataSources.mockReturnValue({
      ...successfulQuery(mockRefetchDataSources),
      data: [
        {
          id: "source-123",
          name: "Local Files",
          type: "local",
          config: { hasApiKey: false, hasConnectionString: false },
          createdAt: 0,
        },
      ],
    });

    render(<DataSourcesPage />);

    const action = screen.getByRole("button", { name: "More options" });

    // The reveal is a CSS group relationship and jsdom computes no Tailwind, so
    // actual visibility cannot be asserted here — the name says what this pins
    // rather than overstating it. What it does check is every part the behavior
    // needs, because dropping any one of them ships a broken UI that still
    // looks right in the markup:
    //   - `opacity-0` hides the action by default (without it, always visible)
    //   - `group-hover:opacity-100` keeps the pointer path working
    //   - `group-focus-within:opacity-100` is the keyboard path this fixes
    //   - a `.group` ancestor is what those two selectors key on; with no group
    //     the action stays invisible to a keyboard user forever
    // The tokens are spelled out rather than compared against the shared
    // constant: asserting a value against itself passes whatever it becomes.
    for (const token of [
      "opacity-0",
      "group-hover:opacity-100",
      "group-focus-within:opacity-100",
    ]) {
      expect(action.classList).toContain(token);
    }
    expect(action.closest(".group")).not.toBeNull();

    // Focus is still exercised so the control is known to be reachable at all.
    action.focus();
    expect(document.activeElement).toBe(action);
  });
});
