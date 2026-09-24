import { nativeQueryMock } from "@/test/native-query-fixture";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { CommandPalette } from "./command-palette";
import { useCommandPalette } from "./command-palette-store";

const { mockNavigate, mockCommitBatch, mockPlatform, mockRouter } = vi.hoisted(
  () => ({
    mockNavigate: vi.fn(async () => {}),
    mockCommitBatch: vi.fn(async () => ({})),
    mockPlatform: { isMacOS: true },
    mockRouter: { state: { location: { pathname: "/dashboards" } } },
  }),
);

const REPORT = {
  id: "weekly",
  name: "Weekly sales",
  createdAt: 0,
  items: [
    {
      id: "tile",
      type: "visualization",
      visualizationId: "by-category",
      x: 0,
      y: 0,
      width: 6,
      height: 6,
    },
  ],
};

/** Lists that are still loading or failed, by query name; reset per test. */
const LIST_STATES: Record<string, { isLoading?: true; isError?: true }> = {};

const LISTS: Record<string, unknown[]> = {
  listDashboards: [REPORT],
  listVisualizations: [
    { id: "by-category", name: "Sum of Sales by Category", createdAt: 0 },
  ],
};

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useMutation: () => mockCommitBatch,
  useQuery_experimental: nativeQueryMock(
    (ref: { _path: string }) =>
      LIST_STATES[ref._path] ?? { data: LISTS[ref._path] ?? [] },
  ),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useRouter: () => mockRouter,
}));
vi.mock("@/lib/platform", () => ({
  usePlatform: () => mockPlatform,
}));

beforeAll(() => {
  // cmdk scrolls the selected item into view and measures its list; the test
  // DOM implements neither.
  Element.prototype.scrollIntoView ??= () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

beforeEach(() => {
  mockNavigate.mockClear();
  mockCommitBatch.mockClear();
  useCommandPalette.setState({ open: false });
  mockPlatform.isMacOS = true;
  mockRouter.state.location.pathname = "/dashboards";
  for (const key of Object.keys(LIST_STATES)) delete LIST_STATES[key];
});

function pressShortcut(target: Window | Element = window) {
  act(() => {
    fireEvent.keyDown(
      target,
      mockPlatform.isMacOS
        ? { key: "k", metaKey: true }
        : { key: "k", ctrlKey: true },
    );
  });
}

describe("CommandPalette", () => {
  it("opens on ⌘K, closes on Escape and gives focus back", async () => {
    render(
      <>
        <button type="button">Before</button>
        <CommandPalette />
      </>,
    );
    const before = screen.getByRole("button", { name: "Before" });
    before.focus();

    pressShortcut();
    const input = await screen.findByRole("combobox", { name: "Search" });
    await waitFor(() => expect(document.activeElement).toBe(input));
    // Opens on actions, found without typing.
    expect(screen.getByRole("option", { name: "New report" })).toBeTruthy();

    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
    expect(useCommandPalette.getState().open).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(before));
  });

  it("opens a chart's report on that chart's tab from the keyboard, then gives focus back", async () => {
    render(
      <>
        <button type="button">Before</button>
        <CommandPalette />
      </>,
    );
    const before = screen.getByRole("button", { name: "Before" });
    before.focus();
    pressShortcut();
    const input = await screen.findByRole("combobox");

    fireEvent.change(input, { target: { value: "category" } });
    await waitFor(() =>
      expect(
        screen
          .getByRole("option", { name: /Sum of Sales by Category/ })
          .getAttribute("data-selected"),
      ).toBe("true"),
    );
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/dashboards/weekly",
        search: { chart: "by-category" },
        replace: false,
      }),
    );
    expect(useCommandPalette.getState().open).toBe(false);
    expect(mockCommitBatch).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(before));
  });

  it.each([
    ["/dashboards", false],
    ["/data-sources", true],
    ["/data-sources/", true],
  ])(
    "opens Add data source from %s, replacing the entry: %s",
    async (pathname, replace) => {
      mockRouter.state.location.pathname = pathname;
      render(<CommandPalette />);
      pressShortcut();
      const input = await screen.findByRole("combobox");
      fireEvent.change(input, { target: { value: ">add data" } });
      await waitFor(() =>
        expect(
          screen
            .getByRole("option", { name: "Add data source" })
            .getAttribute("data-selected"),
        ).toBe("true"),
      );
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() =>
        expect(mockNavigate).toHaveBeenCalledWith({
          to: "/data-sources",
          search: { addSource: true },
          replace,
        }),
      );
    },
  );

  it("does not open over another open dialog", async () => {
    render(
      <>
        <div role="dialog" aria-label="Add field" />
        <CommandPalette />
      </>,
    );
    // The shortcut is still claimed, so the browser's own ⌘K / Ctrl+K search
    // does not take focus out of that dialog.
    const event = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(useCommandPalette.getState().open).toBe(false);
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it.each([
    ["/dashboards/weekly", true],
    ["/dashboards/weekly/", true],
    ["/dashboards/other", false],
    ["/data-sources", false],
  ])(
    "opens a chart from %s, replacing the entry: %s",
    async (pathname, replace) => {
      mockRouter.state.location.pathname = pathname;
      render(<CommandPalette />);
      pressShortcut();
      const input = await screen.findByRole("combobox");
      fireEvent.change(input, { target: { value: "category" } });
      await waitFor(() =>
        expect(
          screen
            .getByRole("option", { name: /Sum of Sales by Category/ })
            .getAttribute("data-selected"),
        ).toBe("true"),
      );
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() =>
        expect(mockNavigate).toHaveBeenCalledWith({
          to: "/dashboards/weekly",
          search: { chart: "by-category" },
          replace,
        }),
      );
    },
  );

  it("says a search is incomplete while a list loads, and when one failed", async () => {
    LIST_STATES.listDataTables = { isLoading: true };
    const { unmount } = render(<CommandPalette />);
    pressShortcut();
    let input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "zzzz" } });
    expect(await screen.findByText("Loading…")).toBeTruthy();
    expect(screen.queryByText("No results")).toBeNull();
    unmount();

    LIST_STATES.listDataTables = { isError: true };
    useCommandPalette.setState({ open: false });
    render(<CommandPalette />);
    pressShortcut();
    input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "zzzz" } });
    expect(
      await screen.findByText("No results. Some lists couldn't load."),
    ).toBeTruthy();
  });

  it("moves with the arrow keys and runs an action after `>`", async () => {
    render(<CommandPalette />);
    pressShortcut();
    const input = await screen.findByRole("combobox");

    fireEvent.change(input, { target: { value: ">go" } });
    await waitFor(() =>
      expect(screen.queryByRole("option", { name: /Weekly sales/ })).toBeNull(),
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole("option", { name: "Go to Reports" })
          .getAttribute("data-selected"),
      ).toBe("true"),
    );
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/data-sources" }),
    );
  });

  it("toggles on Ctrl+K off macOS, including from inside the palette", async () => {
    mockPlatform.isMacOS = false;
    render(<CommandPalette />);
    pressShortcut();
    const input = await screen.findByRole("combobox");

    pressShortcut(input);
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
    expect(useCommandPalette.getState().open).toBe(false);
  });
});
