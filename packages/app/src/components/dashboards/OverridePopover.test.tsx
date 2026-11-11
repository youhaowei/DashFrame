/**
 * The sort and limit rows of the tile override popover:
 *
 * - The sort row edits a one-key override, because a tile runs one runtime
 *   sort key.  Every edit saves one key, and Pin saves a reference the field
 *   select can show.
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
import { buildSortFieldOptions } from "./override-field-row-utils";
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

const regionId = "20000000-0000-4000-8000-000000000001";
const orderDateId = "20000000-0000-4000-8000-000000000002";
const revenueId = "20000000-0000-4000-8000-000000000003";
const fields = buildSortFieldOptions(
  [
    { id: regionId, name: "Region", columnName: "region" },
    { id: orderDateId, name: "Order date", columnName: "order_date" },
  ],
  [{ id: revenueId, name: "Revenue" }],
);
const regionAlias = "field_20000000_0000_4000_8000_000000000001";
const revenueAlias = "metric_20000000_0000_4000_8000_000000000003";
/** A list longer than a tile runs, as saved before writes rejected it. */
const twoKeys: InsightSort[] = [
  { field: "region", direction: "asc" },
  { field: "order_date", direction: "desc" },
];

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
  /** The field select's text, without its chevron. */
  const shownField = () =>
    screen.getAllByRole("combobox")[0]!.querySelector("span")?.textContent;

  function renderRow(props: {
    insightSorts?: InsightSort[];
    overrideSorts?: InsightSort[];
  }) {
    const onChange = vi.fn();
    render(<SortOverrideRow {...props} fields={fields} onChange={onChange} />);
    return { onChange, user: userEvent.setup({ delay: null }) };
  }

  it("names every key of the inherited default by field, not by stored alias", () => {
    renderRow({
      insightSorts: [
        { field: regionAlias, direction: "asc" },
        { field: revenueAlias, direction: "desc" },
      ],
    });
    expect(screen.getByText("default: Region asc, Revenue desc")).toBeTruthy();
  });

  it("pins the Insight's first sort key by a reference the field select shows", async () => {
    const { onChange, user } = renderRow({
      insightSorts: [
        { field: revenueAlias, direction: "desc" },
        { field: regionAlias, direction: "asc" },
      ],
    });

    await user.click(screen.getByRole("button", { name: "Pin" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([
      { field: revenueId, direction: "desc" },
    ]);
  });

  it.each([
    ["id", revenueId],
    ["result-column alias", revenueAlias],
    ["name", "Revenue"],
  ])("shows a pinned field stored by its %s by name", (_form, field) => {
    renderRow({ overrideSorts: [{ field, direction: "desc" }] });
    expect(shownField()).toBe("Revenue");
  });

  it("lists only the one key it edits", () => {
    renderRow({ overrideSorts: twoKeys });
    expect(shownField()).toBe("Region");
    expect(screen.queryByText(/order.date/i)).toBeNull();
  });

  it("saves one key when the field changes", async () => {
    const { onChange, user } = renderRow({ overrideSorts: twoKeys });

    await user.click(screen.getAllByRole("combobox")[0]!);
    await user.click(await screen.findByRole("option", { name: "Revenue" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([
      { field: revenueId, direction: "asc" },
    ]);
  });

  it("saves one key when the direction changes", async () => {
    const { onChange, user } = renderRow({ overrideSorts: twoKeys });

    await user.click(screen.getAllByRole("combobox")[1]!);
    await user.click(await screen.findByRole("option", { name: "desc" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([
      { field: "region", direction: "desc" },
    ]);
  });

  it("offers only what the Insight allows, and still names a pinned field it does not", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <SortOverrideRow
        overrideSorts={[{ field: revenueId, direction: "desc" }]}
        fields={buildSortFieldOptions(
          [{ id: regionId, name: "Region", columnName: "region" }],
          [{ id: revenueId, name: "Revenue" }],
          [regionId],
        )}
        onChange={vi.fn()}
      />,
    );
    expect(shownField()).toBe("Revenue");

    await user.click(screen.getAllByRole("combobox")[0]!);
    expect(await screen.findByRole("option", { name: "Region" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Revenue" })).toBeNull();
  });

  it("offers no Pin when the tile has nothing to sort by", () => {
    render(
      <SortOverrideRow
        fields={buildSortFieldOptions([], [])}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Pin" }).hasAttribute("disabled"),
    ).toBe(true);
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
