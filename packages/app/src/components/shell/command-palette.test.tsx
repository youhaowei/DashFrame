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

const { mockNavigate, mockCommitBatch, mockPlatform } = vi.hoisted(() => ({
  mockNavigate: vi.fn(async () => {}),
  mockCommitBatch: vi.fn(async () => ({})),
  mockPlatform: { isMacOS: true },
}));

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

const LISTS: Record<string, unknown[]> = {
  listDashboards: [REPORT],
  listVisualizations: [
    { id: "by-category", name: "Sum of Sales by Category", createdAt: 0 },
  ],
};

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useMutation: () => mockCommitBatch,
  useQuery_experimental: nativeQueryMock((ref: { _path: string }) => ({
    data: LISTS[ref._path] ?? [],
  })),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
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
    const input = await screen.findByRole("combobox");
    await waitFor(() => expect(document.activeElement).toBe(input));
    // Opens on actions, found without typing.
    expect(screen.getByRole("option", { name: "New report" })).toBeTruthy();

    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
    expect(useCommandPalette.getState().open).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(before));
  });

  it("opens a chart's report on that chart's tab from the keyboard", async () => {
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
      }),
    );
    expect(useCommandPalette.getState().open).toBe(false);
    expect(mockCommitBatch).not.toHaveBeenCalled();
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
