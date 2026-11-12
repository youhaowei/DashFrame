/**
 * The sort and limit rows of the tile override popover:
 *
 * - The sort row edits a one-key override, because a tile runs one runtime
 *   sort key.  Every edit saves one key, and Pin saves a reference the field
 *   select can show.
 * - The limit row keeps a local draft.  The saved limit can change while the
 *   editor is open; an editor the user never typed in must not write its old
 *   number back, and a user's typing must survive that change.
 *
 * And which rows the popover offers at all.  A tile override runs through a
 * control the chart's Insight declares for viewers, so for each of filter,
 * sort, and limit: the row is shown when declared, absent when not, and
 * reduced to its removal when the tile already holds an undeclared override.
 */

import type {
  DashboardControl,
  DashboardItem,
  DashboardItemOverrides,
  Insight,
  InsightFilter,
  InsightRuntimeDeclaration,
  InsightSort,
  UUID,
} from "@dashframe/types";
import {
  act,
  cleanup,
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
/** What the popover's three artifact lists return, keyed by query name. */
const lists = vi.hoisted(
  () =>
    ({
      listVisualizations: [],
      listInsights: [],
      listDataTables: [],
    }) as Record<string, unknown[]>,
);
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useMutation: () => commitBatch,
}));
// The list hook hands its query on, and the status helper answers for it.
vi.mock("@/data/artifact-lists", () => ({
  useArtifactList: ({ query }: { query: unknown }) => query,
}));
vi.mock("@/data/query-status", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    queryStatus: (query: never) => ({
      data: lists[getFunctionName(query).split(":")[1]!],
    }),
  };
});
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

const insightId = "10000000-0000-4000-8000-000000000004" as UUID;
/** The saved filter a runtime filter on `region` declares. */
const regionFilter = {
  id: "region-filter",
  field: "region",
  operator: "eq" as const,
  value: "EMEA",
};
const regionControl = {
  key: "region",
  filterId: regionFilter.id,
  label: "Region",
};

function makeInsight(
  runtimeControls?: InsightRuntimeDeclaration,
  filters: InsightFilter[] = [regionFilter],
): Insight {
  return {
    id: insightId,
    name: "Sales",
    source: {
      sourceType: "dataTable",
      sourceId: "10000000-0000-4000-8000-000000000005" as UUID,
    },
    selectedFields: [],
    metrics: [],
    filters,
    runtimeControls,
    createdAt: 0,
  };
}

/** An Insight that declares a viewer sort, limit, and `region` filter. */
const declaringInsight = makeInsight({
  filters: [regionControl],
  sort: { allowedFieldIds: [regionId as UUID], maxKeys: 1 },
  limit: { min: 1, max: 500 },
});

function tileWith(overrides?: DashboardItemOverrides): DashboardItem {
  return { ...tile, overrides };
}

/**
 * Opens the popover for a tile.  `insight: null` is a chart whose Insight is
 * gone; `loading` leaves the Insight list still on its way.
 */
async function openPopover({
  item = tile,
  insight = declaringInsight,
  loading = false,
  controls = [],
  effectiveOverrides,
  onEditChart,
}: {
  item?: DashboardItem;
  insight?: Insight | null;
  loading?: boolean;
  controls?: DashboardControl[];
  effectiveOverrides?: DashboardItemOverrides;
  onEditChart?: (visualizationId: string) => void;
} = {}) {
  lists.listVisualizations = [{ id: item.visualizationId, insightId }];
  lists.listInsights = insight ? [insight] : [];
  // A list has no data until its last page is in.
  if (loading) delete lists.listInsights;
  const user = userEvent.setup({ delay: null });
  render(
    <OverridePopover
      item={item}
      dashboardId={dashboardId}
      controls={controls}
      effectiveOverrides={effectiveOverrides}
      onEditChart={onEditChart}
    />,
  );
  await user.click(
    screen.getByRole("button", { name: "Customize cell overrides" }),
  );
  return user;
}

/** The single command the popover committed. */
function committedPatch() {
  expect(commitBatch).toHaveBeenCalledTimes(1);
  return commitBatch.mock.calls[0]![0].commands[0].args.patch;
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

describe("OverridePopover offered controls", () => {
  const noChoices =
    "This chart offers viewers no sort, limit, or filter choices. Turn them on in the chart editor.";
  const chartDeleted = "This tile's chart was deleted.";

  beforeEach(() => {
    commitBatch.mockReset();
    commitBatch.mockResolvedValue({});
    lists.listDataTables = [];
    vi.stubGlobal("PointerEvent", MouseEvent);
  });
  afterEach(() => vi.unstubAllGlobals());

  describe("sort", () => {
    const staleSort = "The chart no longer offers sort to viewers.";

    it("is offered when the Insight declares a viewer sort", async () => {
      await openPopover({
        item: tileWith(),
        insight: makeInsight({
          sort: { allowedFieldIds: [regionId as UUID], maxKeys: 1 },
        }),
      });

      expect(screen.getByRole("button", { name: "Pin" })).toBeTruthy();
      expect(screen.queryByText(noChoices)).toBeNull();
    });

    it("is not shown when the Insight declares none", async () => {
      await openPopover({
        item: tileWith(),
        insight: makeInsight({ limit: { min: 1, max: 500 } }),
      });

      expect(screen.queryByText("Sort")).toBeNull();
      expect(screen.queryByText(staleSort)).toBeNull();
    });

    it("offers only the reset when the tile holds a sort the Insight no longer declares", async () => {
      const user = await openPopover({
        item: tileWith({ sorts: [{ field: "region", direction: "asc" }] }),
        insight: makeInsight(),
      });

      expect(screen.getByText(staleSort)).toBeTruthy();
      expect(screen.queryByRole("combobox")).toBeNull();
      expect(screen.queryByRole("button", { name: "Pin" })).toBeNull();
      expect(screen.queryByText(noChoices)).toBeNull();

      await user.click(
        screen.getByRole("button", { name: "Reset sort to inherit" }),
      );
      expect(committedPatch()).toEqual({ kind: "sorts", value: null });
    });
  });

  describe("limit", () => {
    const staleLimit = "The chart no longer offers a limit to viewers.";

    it("is offered when the Insight declares a viewer limit, and pins inside its range", async () => {
      const user = await openPopover({
        item: tileWith(),
        insight: makeInsight({ limit: { min: 1, max: 50 } }),
      });

      expect(screen.getByText("1–50 rows")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Pin" }));
      // Pin's starting value is 100, which this Insight would refuse.
      expect(committedPatch()).toEqual({ kind: "limit", value: 50 });
    });

    it("saves a typed limit inside the range the Insight offers", async () => {
      await openPopover({
        item: tileWith({ limit: 20 }),
        insight: makeInsight({ limit: { min: 10, max: 50 } }),
      });
      const input = screen.getByRole("spinbutton") as HTMLInputElement;

      fireEvent.change(input, { target: { value: "900" } });
      fireEvent.blur(input);

      expect(committedPatch()).toEqual({ kind: "limit", value: 50 });
      expect(input.value).toBe("50");
    });

    it("is not shown when the Insight declares none", async () => {
      await openPopover({
        item: tileWith(),
        insight: makeInsight({
          sort: { allowedFieldIds: [regionId as UUID], maxKeys: 1 },
        }),
      });

      expect(screen.queryByText("Limit")).toBeNull();
      expect(screen.queryByText(staleLimit)).toBeNull();
    });

    it("offers only the reset when the tile holds a limit the Insight no longer declares", async () => {
      const user = await openPopover({
        item: tileWith({ limit: 25 }),
        insight: makeInsight(),
      });

      expect(screen.getByText(staleLimit)).toBeTruthy();
      expect(screen.queryByRole("spinbutton")).toBeNull();
      expect(screen.queryByRole("button", { name: "Pin" })).toBeNull();

      await user.click(
        screen.getByRole("button", { name: "Reset limit to inherit" }),
      );
      expect(committedPatch()).toEqual({ kind: "limit", value: null });
    });
  });

  describe("filter", () => {
    const staleFilter = "The chart no longer offers this filter to viewers.";

    it("is offered for a field with a declared runtime filter, and pins by its saved-filter id", async () => {
      const user = await openPopover({
        item: tileWith(),
        insight: makeInsight({ filters: [regionControl] }),
      });

      expect(screen.getByText("default: = EMEA")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Pin" }));
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "West" },
      });
      await user.click(screen.getByRole("button", { name: "Pin" }));

      expect(committedPatch()).toEqual({
        kind: "filter",
        field: "region",
        value: {
          id: regionFilter.id,
          field: "region",
          operator: "eq",
          value: "West",
        },
      });
    });

    it("edits a value under the saved filter's operator, and offers no other", async () => {
      const contains = { ...regionFilter, operator: "contains" as const };
      const user = await openPopover({
        item: tileWith(),
        insight: makeInsight({ filters: [regionControl] }, [contains]),
      });

      await user.click(screen.getByRole("button", { name: "Pin" }));
      // The tile runs the saved operator with the pinned value, so there is
      // no operator to choose.
      expect(screen.queryByRole("combobox")).toBeNull();
      fireEvent.change(screen.getByRole("textbox", { name: "region value" }), {
        target: { value: "West" },
      });
      await user.click(screen.getByRole("button", { name: "Pin" }));

      expect(committedPatch().value).toEqual({
        id: regionFilter.id,
        field: "region",
        operator: "contains",
        value: "West",
      });
    });

    it("shows a value pinned under another operator with the operator the tile runs", async () => {
      const user = await openPopover({
        item: tileWith({
          filters: [
            {
              id: regionFilter.id,
              field: "region",
              operator: "ne",
              value: "West",
            },
          ],
        }),
        insight: makeInsight({ filters: [regionControl] }),
      });

      expect(screen.getByRole("button", { name: "= West" })).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Edit" }));
      fireEvent.change(screen.getByRole("textbox", { name: "region value" }), {
        target: { value: "East" },
      });
      await user.click(screen.getByRole("button", { name: "Pin" }));

      expect(committedPatch().value).toMatchObject({
        operator: "eq",
        value: "East",
      });
    });

    it("offers a control to bind only when the declared filter is a clearable equality", async () => {
      const control: DashboardControl = {
        id: "10000000-0000-4000-8000-000000000006" as UUID,
        field: "region",
        boundInstances: [],
      };
      // The popover finds a control's field among the Insight's fields.
      lists.listDataTables = [
        {
          id: declaringInsight.source.sourceId,
          name: "sales",
          fields: [{ id: regionId, name: "Region", columnName: "region" }],
        },
      ];
      const bind = () =>
        screen.queryByRole("combobox", { name: "Bind to dashboard control" });

      await openPopover({
        item: tileWith(),
        insight: makeInsight({
          filters: [{ ...regionControl, allowClear: true }],
        }),
        controls: [control],
      });
      expect(bind()).toBeTruthy();
      cleanup();

      // A blank control sends a clear, which this declaration refuses.
      await openPopover({
        item: tileWith(),
        insight: makeInsight({ filters: [regionControl] }),
        controls: [control],
      });
      expect(bind()).toBeNull();
    });

    it("shows the declared filter's default when the field carries another saved filter", async () => {
      await openPopover({
        item: tileWith(),
        insight: makeInsight({ filters: [regionControl] }, [
          regionFilter,
          { id: "not-test", field: "region", operator: "ne", value: "Test" },
        ]),
      });

      expect(screen.getByText("default: = EMEA")).toBeTruthy();
    });

    it.each([
      {
        name: "keeps the bound row for a blank control, which clears a filter that allows it",
        defaultValue: undefined,
        stale: false,
      },
      {
        name: "offers only Unbind for a control whose value the filter's operator cannot take",
        defaultValue: "West",
        stale: true,
      },
    ])("$name", async ({ defaultValue, stale }) => {
      // A control sends an equality; this declared filter is not one.
      await openPopover({
        item: tileWith(),
        insight: makeInsight(
          { filters: [{ ...regionControl, allowClear: true }] },
          [{ ...regionFilter, operator: "contains" }],
        ),
        controls: [
          {
            id: "10000000-0000-4000-8000-000000000006" as UUID,
            field: "region",
            label: "Region picker",
            defaultValue,
            boundInstances: [tile.id],
          },
        ],
      });

      expect(screen.queryByText(staleFilter) !== null).toBe(stale);
      expect(screen.queryByText("← Region picker") !== null).toBe(!stale);
    });

    it("offers only Unbind when a viewer's unsaved control value is one the filter cannot take", async () => {
      // The control's saved default is blank, which clears the filter and
      // runs.  The viewer has typed a value since: the tile now sends an
      // equality this `contains` filter does not take, and the row says so.
      await openPopover({
        item: tileWith(),
        insight: makeInsight(
          { filters: [{ ...regionControl, allowClear: true }] },
          [{ ...regionFilter, operator: "contains" }],
        ),
        controls: [
          {
            id: "10000000-0000-4000-8000-000000000006" as UUID,
            field: "region",
            label: "Region picker",
            boundInstances: [tile.id],
          },
        ],
        effectiveOverrides: {
          filters: [{ field: "region", operator: "eq", value: "West" }],
        },
      });

      expect(screen.getByText(staleFilter)).toBeTruthy();
      expect(screen.queryByText("← Region picker")).toBeNull();
      expect(
        screen.getByRole("button", { name: "Unbind region from control" }),
      ).toBeTruthy();
    });

    it("keeps the bound row when the control drives a declared equality", async () => {
      await openPopover({
        item: tileWith(),
        insight: makeInsight({ filters: [regionControl] }),
        controls: [
          {
            id: "10000000-0000-4000-8000-000000000006" as UUID,
            field: "region",
            label: "Region picker",
            boundInstances: [tile.id],
          },
        ],
      });

      expect(screen.getByText("← Region picker")).toBeTruthy();
      expect(screen.queryByText(staleFilter)).toBeNull();
      expect(screen.getByRole("button", { name: "Unbind" })).toBeTruthy();
    });

    describe("on a field with two declared filters", () => {
      const range: InsightFilter[] = [
        { id: "min", field: "amount", operator: "gte", value: 10 },
        { id: "max", field: "amount", operator: "lte", value: 20 },
      ];
      const both = makeInsight(
        {
          filters: [
            { key: "min", filterId: "min", label: "Minimum" },
            { key: "max", filterId: "max", label: "Maximum" },
          ],
        },
        range,
      );

      it("offers no row to pin from, and says why instead of that the chart offers nothing", async () => {
        await openPopover({ item: tileWith(), insight: both });

        expect(screen.queryByText("Filters")).toBeNull();
        expect(screen.queryByText(noChoices)).toBeNull();
        expect(
          screen.getByText(
            "This chart's viewer filters share a field, so a tile can't pin one.",
          ),
        ).toBeTruthy();
      });

      it("offers no control to bind on a row a held override picked: the control's own override names neither", async () => {
        const clearableEqualities = makeInsight(
          {
            filters: [
              { key: "a", filterId: "a", label: "A", allowClear: true },
              { key: "b", filterId: "b", label: "B", allowClear: true },
            ],
          },
          [
            { id: "a", field: "region", operator: "eq", value: "East" },
            { id: "b", field: "region", operator: "eq", value: "West" },
          ],
        );
        lists.listDataTables = [
          {
            id: clearableEqualities.source.sourceId,
            name: "sales",
            fields: [{ id: regionId, name: "Region", columnName: "region" }],
          },
        ];
        await openPopover({
          item: tileWith({
            filters: [
              { id: "a", field: "region", operator: "eq", value: "North" },
            ],
          }),
          insight: clearableEqualities,
          controls: [
            {
              id: "10000000-0000-4000-8000-000000000006" as UUID,
              field: "region",
              boundInstances: [],
            },
          ],
        });

        expect(screen.getByRole("button", { name: "= North" })).toBeTruthy();
        expect(
          screen.queryByRole("combobox", { name: "Bind to dashboard control" }),
        ).toBeNull();
      });

      it("edits the one a held override names, instead of calling it undeclared", async () => {
        await openPopover({
          item: tileWith({
            filters: [
              { id: "max", field: "amount", operator: "lte", value: 15 },
            ],
          }),
          insight: both,
        });

        expect(screen.getByRole("button", { name: "≤ 15" })).toBeTruthy();
        expect(screen.queryByText(staleFilter)).toBeNull();
      });
    });

    it("offers Clear only when the declared filter allows clearing", async () => {
      await openPopover({
        item: tileWith(),
        insight: makeInsight({ filters: [regionControl] }),
      });
      expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    });

    it("clears by the declared filter's id when it allows clearing", async () => {
      const user = await openPopover({
        item: tileWith(),
        insight: makeInsight({
          filters: [{ ...regionControl, allowClear: true }],
        }),
      });

      await user.click(screen.getByRole("button", { name: "Clear" }));

      expect(committedPatch()).toEqual({
        kind: "filter",
        field: "region",
        value: {
          id: regionFilter.id,
          field: "region",
          operator: "eq",
          value: null,
          cleared: true,
        },
      });
    });

    it("is not shown for a field the Insight filters on but does not declare", async () => {
      await openPopover({
        item: tileWith(),
        insight: makeInsight({ limit: { min: 1, max: 500 } }),
      });

      expect(screen.queryByText("Filters")).toBeNull();
      expect(screen.queryByText("region")).toBeNull();
    });

    it.each([
      {
        name: "pinned",
        override: { field: "region", operator: "eq" as const, value: "West" },
      },
      {
        name: "cleared",
        override: {
          field: "region",
          operator: "eq" as const,
          value: null,
          cleared: true,
        },
      },
    ])(
      "offers only the reset when the tile holds a $name filter the Insight no longer declares",
      async ({ override }) => {
        const user = await openPopover({
          item: tileWith({ filters: [override] }),
          insight: makeInsight(),
        });

        expect(screen.getByText(staleFilter)).toBeTruthy();
        for (const name of ["Pin", "Edit", "Clear"])
          expect(screen.queryByRole("button", { name })).toBeNull();

        await user.click(
          screen.getByRole("button", {
            name: "Reset region filter to inherit",
          }),
        );
        expect(committedPatch()).toEqual({
          kind: "filter",
          field: "region",
          value: null,
        });
      },
    );

    it("offers only Unbind when a bound control drives a filter the Insight no longer declares", async () => {
      const control: DashboardControl = {
        id: "10000000-0000-4000-8000-000000000006" as UUID,
        field: "region",
        boundInstances: [tile.id],
      };
      const user = await openPopover({
        item: tileWith(),
        insight: makeInsight(),
        controls: [control],
      });

      expect(screen.getByText(staleFilter)).toBeTruthy();
      await user.click(
        screen.getByRole("button", { name: "Unbind region from control" }),
      );

      expect(commitBatch.mock.calls[0]![0].commands[0].args).toEqual({
        dashboardId,
        controls: [{ ...control, boundInstances: [] }],
      });
    });
  });

  describe("no declared controls", () => {
    it("says the chart offers viewers no choices, and keeps Edit chart", async () => {
      const onEditChart = vi.fn();
      const user = await openPopover({
        item: tileWith(),
        insight: makeInsight(),
        onEditChart,
      });

      expect(screen.getByText(noChoices)).toBeTruthy();
      for (const heading of ["Filters", "Sort", "Limit"])
        expect(screen.queryByText(heading)).toBeNull();
      expect(screen.queryByRole("button", { name: "Pin" })).toBeNull();

      await user.click(screen.getByRole("button", { name: "Edit chart" }));
      expect(onEditChart).toHaveBeenCalledWith(tile.visualizationId);
    });

    it("claims nothing while the Insight is still loading", async () => {
      await openPopover({ item: tileWith({ limit: 25 }), loading: true });

      expect(screen.getByText("Cell overrides")).toBeTruthy();
      expect(screen.queryByText(noChoices)).toBeNull();
      expect(screen.queryByText(chartDeleted)).toBeNull();
      expect(screen.queryByText("Limit")).toBeNull();
    });

    it("shows no row until the tables its fields come from are loaded", async () => {
      delete lists.listDataTables;
      await openPopover({ item: tileWith({ limit: 25 }) });

      expect(screen.queryByText("Limit")).toBeNull();
      expect(screen.queryByText("Filters")).toBeNull();
      expect(screen.queryByText(chartDeleted)).toBeNull();
    });

    it("says the chart was deleted when its Insight is gone", async () => {
      await openPopover({ item: tileWith({ limit: 25 }), insight: null });

      expect(screen.getByText(chartDeleted)).toBeTruthy();
    });

    it("offers no Edit chart for a chart that was deleted", async () => {
      lists.listVisualizations = [];
      const user = userEvent.setup({ delay: null });
      render(
        <OverridePopover
          item={tileWith({ limit: 25 })}
          dashboardId={dashboardId}
          controls={[]}
          onEditChart={vi.fn()}
        />,
      );
      await user.click(
        screen.getByRole("button", { name: "Customize cell overrides" }),
      );

      expect(screen.getByText(chartDeleted)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Edit chart" })).toBeNull();
      expect(screen.queryByText(noChoices)).toBeNull();
      expect(screen.queryByText("Limit")).toBeNull();
    });
  });
});
