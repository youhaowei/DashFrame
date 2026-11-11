/**
 * The sort and limit rows of the tile override popover:
 *
 * - The sort row edits a one-key override, because a tile runs one runtime
 *   sort key.  Every edit saves one key.
 * - The limit row keeps a local draft.  The saved limit can change while the
 *   editor is open; an editor the user never typed in must not write its old
 *   number back, and a user's typing must survive that change.
 */

import type { DashboardItem, InsightSort, UUID } from "@dashframe/types";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import {
  LimitOverrideRow,
  OverridePopover,
  SortOverrideRow,
} from "./OverridePopover";

const commitBatch = vi.hoisted(() => vi.fn());
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useMutation: () => commitBatch,
}));
vi.mock("@/data/artifact-lists", () => ({ useArtifactList: () => undefined }));
vi.mock("@/data/query-status", () => ({ queryStatus: () => ({ data: [] }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

/** A list longer than a tile runs, as saved before writes rejected it. */
const twoKeys: InsightSort[] = [
  { field: "region", direction: "asc" },
  { field: "order_date", direction: "desc" },
];
const fields = ["region", "order_date", "channel"];

const dashboardId = "10000000-0000-4000-8000-000000000001";
const tile = {
  id: "10000000-0000-4000-8000-000000000002" as UUID,
  type: "visualization",
  visualizationId: "10000000-0000-4000-8000-000000000003" as UUID,
  x: 0,
  y: 0,
  width: 6,
  height: 6,
  overrides: { sorts: twoKeys, limit: 100 },
} as DashboardItem;

async function openPopover() {
  const user = userEvent.setup({ delay: null });
  render(
    <OverridePopover item={tile} dashboardId={dashboardId} controls={[]} />,
  );
  await user.click(
    screen.getByRole("button", { name: "Customize cell overrides" }),
  );
  return user;
}

describe("SortOverrideRow", () => {
  it("lists only the one key it edits", () => {
    render(
      <SortOverrideRow
        overrideSorts={twoKeys}
        availableFields={fields}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText(/order_date/)).toBeNull();
  });

  it("names every key of the inherited default", () => {
    render(
      <SortOverrideRow
        insightSorts={twoKeys}
        availableFields={fields}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText("default: region asc, order_date desc"),
    ).toBeTruthy();
  });

  it("names an inherited key by its field, not its stored alias", () => {
    render(
      <SortOverrideRow
        insightSorts={[
          { field: "field_abc", direction: "asc" },
          { field: "metric_def", direction: "desc" },
        ]}
        availableFields={fields}
        fieldLabels={
          new Map([
            ["field_abc", "region"],
            ["metric_def", "Revenue"],
          ])
        }
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("default: region asc, Revenue desc")).toBeTruthy();
  });

  it("saves one key when the field changes", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(
      <SortOverrideRow
        overrideSorts={twoKeys}
        availableFields={fields}
        onChange={onChange}
      />,
    );

    await user.click(screen.getAllByRole("combobox")[0]!);
    await user.click(await screen.findByRole("option", { name: "channel" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([
      { field: "channel", direction: "asc" },
    ]);
  });

  it("saves one key when the direction changes", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(
      <SortOverrideRow
        overrideSorts={twoKeys}
        availableFields={fields}
        onChange={onChange}
      />,
    );

    await user.click(screen.getAllByRole("combobox")[1]!);
    await user.click(await screen.findByRole("option", { name: "desc" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([
      { field: "region", direction: "desc" },
    ]);
  });
});

describe("OverridePopover sort wiring", () => {
  beforeEach(() => {
    commitBatch.mockReset();
    vi.stubGlobal("PointerEvent", MouseEvent);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("saves an edit as a one-key sort patch", async () => {
    commitBatch.mockResolvedValue({});
    const user = await openPopover();

    await user.click(screen.getAllByRole("combobox")[1]!);
    await user.click(await screen.findByRole("option", { name: "desc" }));

    expect(commitBatch).toHaveBeenCalledTimes(1);
    expect(commitBatch.mock.calls[0]![0].commands[0].args).toEqual({
      dashboardId,
      itemId: tile.id,
      patch: {
        kind: "sorts",
        value: [{ field: "region", direction: "desc" }],
      },
    });
  });
});

describe("LimitOverrideRow", () => {
  function limitInput(): HTMLInputElement {
    return screen.getByRole("spinbutton") as HTMLInputElement;
  }

  it("follows a saved limit that changes while the editor is open, and does not write the old one back", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <LimitOverrideRow overrideLimit={100} onChange={onChange} />,
    );
    expect(limitInput().value).toBe("100");

    // Another tab, an agent's published draft, or an undo saves a new limit.
    rerender(<LimitOverrideRow overrideLimit={25} onChange={onChange} />);
    expect(limitInput().value).toBe("25");

    fireEvent.blur(limitInput());
    fireEvent.keyDown(limitInput(), { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not write on blur or Enter when the user typed nothing", () => {
    const onChange = vi.fn();
    render(<LimitOverrideRow overrideLimit={100} onChange={onChange} />);

    fireEvent.focus(limitInput());
    fireEvent.keyDown(limitInput(), { key: "Enter" });
    fireEvent.blur(limitInput());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the user's typing when the saved limit changes underneath it", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <LimitOverrideRow overrideLimit={100} onChange={onChange} />,
    );

    fireEvent.change(limitInput(), { target: { value: "5" } });
    rerender(<LimitOverrideRow overrideLimit={25} onChange={onChange} />);
    expect(limitInput().value).toBe("5");

    fireEvent.change(limitInput(), { target: { value: "50" } });
    fireEvent.blur(limitInput());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(50);
  });

  it("writes a typed limit once across Enter and the blur that follows", () => {
    const onChange = vi.fn();
    render(<LimitOverrideRow overrideLimit={100} onChange={onChange} />);

    fireEvent.change(limitInput(), { target: { value: "40" } });
    fireEvent.keyDown(limitInput(), { key: "Enter" });
    fireEvent.blur(limitInput());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(40);
  });

  it("writes a typed limit that equals the saved one, so it lands after a save still in flight", () => {
    // Saved limit is 100.  The user commits 40, then changes their mind and
    // commits 100 before the first save has come back.  Skipping the second
    // write as "unchanged" would leave the tile at 40.
    const onChange = vi.fn(() => new Promise<boolean>(() => {}));
    render(<LimitOverrideRow overrideLimit={100} onChange={onChange} />);

    fireEvent.change(limitInput(), { target: { value: "40" } });
    fireEvent.keyDown(limitInput(), { key: "Enter" });
    fireEvent.change(limitInput(), { target: { value: "100" } });
    fireEvent.keyDown(limitInput(), { key: "Enter" });

    expect(onChange.mock.calls).toEqual([[40], [100]]);
    expect(limitInput().value).toBe("100");
  });

  it("restores the latest saved limit after an invalid entry", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <LimitOverrideRow overrideLimit={100} onChange={onChange} />,
    );

    fireEvent.change(limitInput(), { target: { value: "0" } });
    rerender(<LimitOverrideRow overrideLimit={25} onChange={onChange} />);
    fireEvent.blur(limitInput());
    expect(onChange).not.toHaveBeenCalled();
    expect(limitInput().value).toBe("25");
  });

  it("shows the saved limit again when the save fails", async () => {
    const onChange = vi.fn().mockResolvedValue(false);
    render(<LimitOverrideRow overrideLimit={100} onChange={onChange} />);

    fireEvent.change(limitInput(), { target: { value: "40" } });
    fireEvent.blur(limitInput());
    expect(onChange).toHaveBeenCalledWith(40);
    await waitFor(() => expect(limitInput().value).toBe("100"));
  });

  it("keeps a newer committed limit on screen when an older save fails", async () => {
    let failFirst: (saved: boolean) => void = () => {};
    const onChange = vi
      .fn<(limit: number | undefined) => Promise<boolean>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            failFirst = resolve;
          }),
      )
      .mockImplementation(() => new Promise(() => {}));
    render(<LimitOverrideRow overrideLimit={100} onChange={onChange} />);

    fireEvent.change(limitInput(), { target: { value: "40" } });
    fireEvent.keyDown(limitInput(), { key: "Enter" });
    fireEvent.change(limitInput(), { target: { value: "60" } });
    fireEvent.keyDown(limitInput(), { key: "Enter" });
    await act(async () => failFirst(false));

    expect(limitInput().value).toBe("60");
  });

  it("drops an abandoned draft when the override is removed and pinned again", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <LimitOverrideRow overrideLimit={100} onChange={onChange} />,
    );

    fireEvent.change(limitInput(), { target: { value: "7" } });
    rerender(
      <LimitOverrideRow overrideLimit={undefined} onChange={onChange} />,
    );
    rerender(<LimitOverrideRow overrideLimit={60} onChange={onChange} />);
    expect(limitInput().value).toBe("60");

    fireEvent.blur(limitInput());
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("OverridePopover limit wiring", () => {
  beforeEach(() => {
    commitBatch.mockReset();
    vi.stubGlobal("PointerEvent", MouseEvent);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("puts the saved limit back when the server rejects a typed one", async () => {
    commitBatch.mockRejectedValue(new Error("rejected"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await openPopover();
    const input = screen.getByRole("spinbutton") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "40" } });
    fireEvent.blur(input);

    expect(commitBatch.mock.calls[0]![0].commands[0].args.patch).toEqual({
      kind: "limit",
      value: 40,
    });
    await waitFor(() => expect(input.value).toBe("100"));
  });
});
