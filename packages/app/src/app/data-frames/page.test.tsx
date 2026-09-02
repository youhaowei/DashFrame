import {
  nativeQueryMock,
  nativeMutationMock,
  hostQueryMock,
  hostMutationMock,
} from "@/test/native-query-fixture";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { mockUseQuery, mockRemoveDataFrame, mockUpdateDataFrameEntry } =
  vi.hoisted(() => ({
    mockUseQuery: vi.fn(),
    mockRemoveDataFrame: vi.fn(),
    mockUpdateDataFrameEntry: vi.fn(),
  }));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock((ref: { _path: string }) =>
    mockUseQuery(ref),
  ),
  useMutation: nativeMutationMock((ref: { _path: string }) => {
    if (ref._path === "updateDataFrameEntry") {
      return { mutateAsync: mockUpdateDataFrameEntry };
    }
    throw new Error(`Unexpected mutation: ${ref._path}`);
  }),
}));
vi.mock("@/data/host", () => ({
  useHostQuery: hostQueryMock((ref: { _path: string }) => mockUseQuery(ref)),
  useHostMutation: hostMutationMock(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock("@/lib/data-access/data-frames", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data-access/data-frames")>()),
  removeDataFrame: mockRemoveDataFrame,
}));

vi.mock("@/hooks/useNow", () => ({
  useNow: () => 1_000_000,
}));

import { ConfirmDialog } from "@/components/confirm-dialog";
import { useConfirmDialogStore } from "@/lib/stores";
import DataFramesPage from "./page";

type FrameOverrides = Record<string, unknown>;

function makeFrame(overrides: FrameOverrides = {}) {
  return {
    id: "frame-1",
    name: "Sales data",
    storage: { type: "indexeddb", key: "sales" },
    fieldIds: [],
    createdAt: 1_000,
    sourceId: "source-1",
    definitionId: "table-1",
    rowCount: 100,
    columnCount: 4,
    lastRefreshedAt: 940_000,
    ...overrides,
  };
}

function configureQueries({
  dataFrames = [makeFrame()],
  dataSources = [{ id: "source-1", name: "Warehouse" }],
  dataTables = [{ id: "table-1", name: "Orders" }],
}: {
  dataFrames?: FrameOverrides[];
  dataSources?: Array<{ id: string; name: string }>;
  dataTables?: Array<{ id: string; name: string }>;
} = {}) {
  mockUseQuery.mockImplementation((ref: { _path: string }) => {
    if (ref._path === "listDataFrames") {
      return { data: dataFrames, isLoading: false };
    }
    if (ref._path === "listDataSources") {
      return { data: dataSources, isLoading: false };
    }
    if (ref._path === "listDataTables") {
      return { data: dataTables, isLoading: false };
    }
    throw new Error(`Unexpected query: ${ref._path}`);
  });
}

async function openFrameMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "More options" }));
}

function frameNamesInDocument(names: string[]) {
  const bodyText = document.body.textContent ?? "";
  return [...names].sort(
    (left, right) => bodyText.indexOf(left) - bodyText.indexOf(right),
  );
}

describe("DataFramesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfirmDialogStore.getState().close();
    mockRemoveDataFrame.mockResolvedValue(undefined);
    mockUpdateDataFrameEntry.mockResolvedValue(undefined);
    configureQueries();
  });

  it("renders source, definition, dimensions, refresh, storage, and created metadata", () => {
    render(<DataFramesPage />);

    expect(screen.getByText("Sales data")).not.toBeNull();
    expect(screen.getByText("Source: Warehouse")).not.toBeNull();
    expect(screen.getByText("Definition: Orders")).not.toBeNull();
    expect(screen.getByText("Dimensions: 100 rows × 4 columns")).not.toBeNull();
    expect(screen.getByText("Last refreshed: 1m ago")).not.toBeNull();
    expect(screen.getByText("Storage: indexeddb")).not.toBeNull();
    expect(
      screen.getByText(`Created: ${new Date(1_000).toLocaleDateString()}`),
    ).not.toBeNull();
  });

  it("filters by name, supports an empty result, and clears the filter", async () => {
    configureQueries({
      dataFrames: [
        makeFrame({ id: "frame-sales", name: "Sales data" }),
        makeFrame({ id: "frame-marketing", name: "Marketing data" }),
      ],
    });
    const user = userEvent.setup();
    render(<DataFramesPage />);

    const search = screen.getByRole("textbox", { name: "Search data frames" });
    await user.type(search, "sales");
    expect(screen.getByText("Sales data")).not.toBeNull();
    expect(screen.queryByText("Marketing data")).toBeNull();

    await user.clear(search);
    await user.type(search, "missing");
    expect(screen.getByText("No data frames found")).not.toBeNull();
    expect(screen.getByText('No data frames match "missing"')).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByText("Sales data")).not.toBeNull();
    expect(screen.getByText("Marketing data")).not.toBeNull();
  });

  it("sorts by name and created time in both directions", async () => {
    const names = ["Gamma", "Alpha", "Beta"];
    configureQueries({
      dataFrames: [
        makeFrame({ id: "frame-gamma", name: "Gamma", createdAt: 1_000 }),
        makeFrame({ id: "frame-alpha", name: "Alpha", createdAt: 3_000 }),
        makeFrame({ id: "frame-beta", name: "Beta", createdAt: 4_000 }),
      ],
    });
    const user = userEvent.setup();
    render(<DataFramesPage />);

    const sort = screen.getByRole("combobox", { name: "Sort data frames" });
    expect(frameNamesInDocument(names)).toEqual(["Alpha", "Beta", "Gamma"]);

    await user.click(sort);
    await user.click(await screen.findByRole("option", { name: "Name (Z–A)" }));
    expect(frameNamesInDocument(names)).toEqual(["Gamma", "Beta", "Alpha"]);
    await waitFor(() =>
      expect(screen.queryByRole("option", { name: "Name (Z–A)" })).toBeNull(),
    );

    await user.click(
      screen.getByRole("combobox", { name: "Sort data frames" }),
    );
    await user.click(
      await screen.findByRole("option", { name: "Created (oldest)" }),
    );
    expect(frameNamesInDocument(names)).toEqual(["Gamma", "Alpha", "Beta"]);
    await waitFor(() =>
      expect(
        screen.queryByRole("option", { name: "Created (oldest)" }),
      ).toBeNull(),
    );

    await user.click(
      screen.getByRole("combobox", { name: "Sort data frames" }),
    );
    await user.click(
      await screen.findByRole("option", { name: "Created (newest)" }),
    );
    expect(frameNamesInDocument(names)).toEqual(["Beta", "Alpha", "Gamma"]);
  });

  it("renames a data frame from its card menu", async () => {
    const user = userEvent.setup();
    render(<DataFramesPage />);

    await openFrameMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Renamed sales");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(mockUpdateDataFrameEntry).toHaveBeenCalledWith({
        id: "frame-1",
        updates: { name: "Renamed sales" },
      }),
    );
  });

  it("does not remove a data frame after cancellation, but removes it after confirmation", async () => {
    const user = userEvent.setup();
    render(
      <>
        <DataFramesPage />
        <ConfirmDialog />
      </>,
    );

    await openFrameMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    expect(screen.getByRole("dialog").textContent).toContain(
      'Are you sure you want to delete "Sales data"? Data tables that reference it may remain and stop working; dependent insights and visualizations may also stop working. This action cannot be undone.',
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockRemoveDataFrame).not.toHaveBeenCalled();

    await openFrameMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(mockRemoveDataFrame).toHaveBeenCalledWith("frame-1"),
    );
  });
});
