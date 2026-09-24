import {
  nativeQueryMock,
  nativeMutationMock,
  hostQueryMock,
  hostMutationMock,
} from "@/test/native-query-fixture";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

const {
  mockNavigate,
  mockRefetchDataSources,
  mockRefetchDataTables,
  mockCommitBatch,
  mockUseDataSources,
  mockUseDataTables,
  mockToastError,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockRefetchDataSources: vi.fn(),
  mockRefetchDataTables: vi.fn(),
  mockCommitBatch: vi.fn(),
  mockUseDataSources: vi.fn(),
  mockUseDataTables: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock((ref: { _path: string }) => {
    if (ref._path === "listDataSources") return mockUseDataSources();
    if (ref._path === "listDataTables") return mockUseDataTables();
    throw new Error(`Unexpected query: ${ref._path}`);
  }),
  useMutation: nativeMutationMock((ref: { _path: string }) => {
    if (ref._path === "commitBatch") {
      return { mutateAsync: mockCommitBatch };
    }
    throw new Error(`Unexpected mutation: ${ref._path}`);
  }),
}));
vi.mock("@/data/host", () => ({
  useHostQuery: hostQueryMock((ref: { _path: string }) => {
    if (ref._path === "listDataSources") return mockUseDataSources();
    if (ref._path === "listDataTables") return mockUseDataTables();
    throw new Error(`Unexpected query: ${ref._path}`);
  }),
  useHostMutation: hostMutationMock((ref: { _path: string }) => {
    if (ref._path === "commitBatch") {
      return { mutateAsync: mockCommitBatch };
    }
    throw new Error(`Unexpected mutation: ${ref._path}`);
  }),
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

vi.mock("@/components/data-sources/AddDataSourceModal", () => ({
  AddDataSourceModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="add-data-source-modal" /> : null,
}));

vi.mock("sonner", () => ({ toast: { error: mockToastError } }));

import { ConfirmDialog } from "@/components/confirm-dialog";
import { registerConnector } from "@/lib/connectors/registry";
import { useConfirmDialogStore } from "@/lib/stores";
import { useShellStore } from "@/lib/stores/shell-store";
import DataSourcesPage from "./page";
import { useState } from "react";

/** The page with its Add dialog state held locally, as the route holds it in the URL. */
function Page() {
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  return (
    <DataSourcesPage
      addSourceOpen={addSourceOpen}
      onAddSourceOpenChange={setAddSourceOpen}
    />
  );
}

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
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    vi.clearAllMocks();
    useConfirmDialogStore.getState().close();
    mockRefetchDataSources.mockResolvedValue(undefined);
    mockRefetchDataTables.mockResolvedValue(undefined);
    mockCommitBatch.mockResolvedValue({ ok: true });
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

      const reload = vi.fn();
      vi.stubGlobal("location", { reload });
      render(<Page />);

      expect(screen.getByRole("alert")).not.toBeNull();
      expect(screen.getByText("Failed to load data sources")).not.toBeNull();
      expect(screen.queryByText("No data sources yet")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: /retry/i }));
      expect(reload).toHaveBeenCalledOnce();
    },
  );

  it("renders the real empty state after both queries succeed", () => {
    render(<Page />);

    expect(screen.getByText("No data sources yet")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each(["header", "empty state"] as const)(
    "opens the add-source dialog from the %s action",
    async (placement) => {
      const user = userEvent.setup();
      render(<Page />);

      const addButtons = screen.getAllByRole("button", { name: "Add Source" });
      await user.click(addButtons[placement === "header" ? 0 : 1]);

      expect(screen.getByTestId("add-data-source-modal")).not.toBeNull();
    },
  );

  it.each(["pointer", "Enter", "Space"] as const)(
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

      render(<Page />);

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

  it("does not remove a data source until the rendered confirmation is accepted", async () => {
    const user = userEvent.setup();
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
        <Page />
        <ConfirmDialog />
      </>,
    );

    await user.click(screen.getByRole("button", { name: "More options" }));
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));

    const dialog = await screen.findByRole("dialog", {
      name: "Delete data source",
    });
    expect(dialog.textContent).toContain(
      'Are you sure you want to delete "Local Files"? This deletes the data source and its data tables. Related DataFrame metadata and storage, and dependent insights, may remain. This action cannot be undone.',
    );
    expect(mockCommitBatch).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockCommitBatch).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "More options" }));
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(mockCommitBatch).toHaveBeenCalledWith({
        commands: [{ path: "deleteNode", args: { id: "source-123" } }],
      });
    });
  });

  it("shows a failure toast when confirmed deletion rejects", async () => {
    const user = userEvent.setup();
    mockCommitBatch.mockRejectedValueOnce(new Error("delete failed"));
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
        <Page />
        <ConfirmDialog />
      </>,
    );

    await user.click(screen.getByRole("button", { name: "More options" }));
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));

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

    render(<Page />);

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

describe("DataSourcesPage collection content", () => {
  const HOUR = 3_600_000;

  beforeAll(() => {
    registerConnector({
      id: "googleAnalytics",
      name: "Google Analytics 4",
      sourceType: "remote-api",
      icon: "<svg></svg>",
    } as never);
    registerConnector({
      id: "local",
      name: "Local Files",
      sourceType: "file",
      icon: "<svg></svg>",
    } as never);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useShellStore.setState({ collectionViews: {} });
    const now = Date.now();
    const source = (id: string, name: string, type: string) => ({
      id,
      name,
      type,
      config: {},
      createdAt: 0,
    });
    const table = (id: string, dataSourceId: string, fetchedAgo: number) => ({
      id,
      name: id,
      dataSourceId,
      table: id,
      fields: [],
      metrics: [],
      createdAt: 0,
      lastFetchedAt: now - fetchedAgo,
    });
    mockUseDataSources.mockReturnValue({
      ...successfulQuery(mockRefetchDataSources),
      data: [
        source("ga", "Marketing site", "googleAnalytics"),
        source("files", "Uploads", "local"),
      ],
    });
    mockUseDataTables.mockReturnValue({
      ...successfulQuery(mockRefetchDataTables),
      data: [
        table("pages", "ga", 2 * HOUR),
        table("events", "ga", 5 * HOUR),
        table("orders.csv", "files", 3 * HOUR),
        table("customers.csv", "files", 1 * HOUR),
      ],
    });
  });

  it("dates a remote source by its stalest table and a file source by its latest import", () => {
    render(<Page />);

    screen.getByText("Google Analytics 4 · 2 tables · refreshed 5h ago");
    screen.getByText("Local Files · 2 tables · imported 1h ago");
  });

  it("finds a source by its provider's display name", async () => {
    const user = userEvent.setup();
    render(<Page />);

    await user.type(
      screen.getByRole("textbox", { name: "Search data sources" }),
      "google analytics",
    );

    screen.getByRole("heading", { name: "Marketing site" });
    expect(screen.queryByRole("heading", { name: "Uploads" })).toBeNull();
  });

  it("drops the provider from rows under its group label", () => {
    useShellStore.setState({ collectionViews: { "data-source": "list" } });
    render(<Page />);

    screen.getByRole("button", { name: "Google Analytics 4 1" });
    screen.getByRole("heading", { level: 3, name: "Marketing site" });
    // Both rows read just "2 tables"; neither repeats its provider.
    expect(screen.getAllByText("2 tables")).toHaveLength(2);
    expect(screen.queryByText(/ · /)).toBeNull();
  });
});
