/**
 * The sort row of the tile override popover edits the first key of a list.
 * Editing it must not delete the keys it does not edit, and the row must say
 * those keys exist.
 */

import type { DashboardItem, InsightSort, UUID } from "@dashframe/types";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { OverridePopover, SortOverrideRow } from "./OverridePopover";

const commitBatch = vi.hoisted(() => vi.fn());
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useMutation: () => commitBatch,
}));
vi.mock("@/data/artifact-lists", () => ({ useArtifactList: () => undefined }));
vi.mock("@/data/query-status", () => ({ queryStatus: () => ({ data: [] }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

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
  it("names the keys after the one it edits", () => {
    render(
      <SortOverrideRow
        overrideSorts={[...twoKeys, { field: "channel", direction: "asc" }]}
        availableFields={fields}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("then order_date desc, channel asc")).toBeTruthy();
  });

  it("adds no line for a single-key sort", () => {
    render(
      <SortOverrideRow
        overrideSorts={[twoKeys[0]!]}
        availableFields={fields}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText(/^then /)).toBeNull();
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

  it("keeps the second key when the first key's field changes", async () => {
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
      { field: "order_date", direction: "desc" },
    ]);
  });

  it("moves a later key's field to the first key instead of duplicating it", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(
      <SortOverrideRow
        overrideSorts={[...twoKeys, { field: "channel", direction: "asc" }]}
        availableFields={fields}
        onChange={onChange}
      />,
    );

    await user.click(screen.getAllByRole("combobox")[0]!);
    await user.click(await screen.findByRole("option", { name: "order_date" }));

    expect(onChange).toHaveBeenCalledWith([
      { field: "order_date", direction: "asc" },
      { field: "channel", direction: "asc" },
    ]);
  });

  it("keeps the second key when the first key's direction changes", async () => {
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
      { field: "order_date", direction: "desc" },
    ]);
  });
});

describe("OverridePopover sort wiring", () => {
  beforeEach(() => {
    commitBatch.mockReset();
    vi.stubGlobal("PointerEvent", MouseEvent);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("saves a first-key edit as a sort patch that still carries the later key", async () => {
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
        value: [
          { field: "region", direction: "desc" },
          { field: "order_date", direction: "desc" },
        ],
      },
    });
  });
});
