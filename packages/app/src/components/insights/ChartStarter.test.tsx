import { nativeMutationMock } from "@/test/native-query-fixture";
/**
 * ChartStarter — an empty chart's canvas.
 *
 * - A suggested chart's card writes its grouping field and metric (and, for a
 *   sorted bar, a largest-first sort) in one batch, the same insight commands
 *   the left pane's pickers send, and reports the chart type it plots.
 * - A column header's menu adds that column as the grouping or a metric.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { mockCommitBatch, pointsState, retry } = vi.hoisted(() => ({
  mockCommitBatch: vi.fn(),
  pointsState: vi.fn(),
  retry: vi.fn(),
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useMutation: nativeMutationMock(() => ({ mutateAsync: mockCommitBatch })),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
// Thumbnails query the host; each test says what a card's aggregate found.
vi.mock("@/lib/visualizations/chart-starter-data", () => ({
  useChartStarterPoints: (
    _insight: unknown,
    suggestion: { key: string },
    revision: string,
  ) => ({ ...pointsState(suggestion.key, revision), retry }),
}));

import { analyzeFrameSample } from "@/lib/visualizations/analyze-frame-sample";
import { suggestChartStarters } from "@/lib/visualizations/chart-starter";
import { metricIdToColumnAlias } from "@dashframe/engine";
import {
  cmd,
  type Command,
  type DataTable,
  type Field,
  type Insight,
  type InsightMetric,
  type UUID,
} from "@dashframe/types";
import {
  buildColumnActionCommands,
  ChartStarter,
  chartStarterMetric,
  thumbnailGeometry,
} from "./ChartStarter";
import { isPlainSumColumn } from "./config-panel/MetricsSection";

const TABLE_ID = "20000000-0000-4000-8000-000000000000" as UUID;
const INSIGHT_ID = "20000000-0000-4000-8000-0000000000aa" as UUID;

const FIELDS: Field[] = [
  { name: "Category", type: "string" },
  { name: "Sales", type: "number" },
].map((field, index) => ({
  ...field,
  id: `20000000-0000-4000-8000-00000000000${index + 1}` as UUID,
  columnName: field.name,
  tableId: TABLE_ID,
})) as Field[];
const [CATEGORY, SALES] = FIELDS as [Field, Field];

const TABLE = {
  id: TABLE_ID,
  name: "sales_data",
  fields: FIELDS,
  metrics: [],
} as unknown as DataTable;

const INSIGHT = {
  id: INSIGHT_ID,
  name: "sales_data",
  source: { sourceType: "dataTable", sourceId: TABLE_ID },
  selectedFields: [],
  metrics: [],
  createdAt: 0,
} as unknown as Insight;

// The server names result columns by their field alias.
const alias = (field: Field) => `field_${field.id.replace(/-/g, "_")}` as UUID;
const SCHEMA = FIELDS.map((field) => ({
  id: alias(field),
  name: field.name,
  type: field.type,
}));
const ROWS = [
  { [alias(CATEGORY)]: "Electronics", [alias(SALES)]: 1200 },
  { [alias(CATEGORY)]: "Furniture", [alias(SALES)]: 150 },
  { [alias(CATEGORY)]: "Electronics", [alias(SALES)]: 25 },
];
const ANALYSIS = analyzeFrameSample(SCHEMA, ROWS, ROWS.length);

function starter(
  insight: Insight,
  onPickChartType: (type: unknown) => void,
  sourceRevision: string,
  table: DataTable = TABLE,
) {
  return (
    <ChartStarter
      insight={insight}
      dataTable={table}
      sample={{
        schema: SCHEMA,
        rows: ROWS,
        totalCount: ROWS.length,
        analysis: ANALYSIS,
      }}
      suggestions={suggestChartStarters(FIELDS, ANALYSIS, ROWS.length)}
      sourceRevision={sourceRevision}
      columnDisplayNames={{
        [alias(CATEGORY)]: "Category",
        [alias(SALES)]: "Sales",
      }}
      onPickChartType={onPickChartType}
    />
  );
}

function renderStarter(
  insight: Insight = INSIGHT,
  onPickChartType = vi.fn(),
  table: DataTable = TABLE,
) {
  const view = render(starter(insight, onPickChartType, "rev-1", table));
  const rerenderAt = (revision: string) =>
    view.rerender(starter(insight, onPickChartType, revision));
  return { onPickChartType, rerenderAt };
}

const withSalesContract = (contract: Record<string, unknown>) =>
  ({
    ...TABLE,
    metrics: [
      {
        id: "20000000-0000-4000-8000-0000000000cc",
        name: "Sales",
        columnName: "Sales",
        aggregation: "sum",
        contract,
      },
    ],
  }) as unknown as DataTable;

async function committed(): Promise<Command[]> {
  await waitFor(() => expect(mockCommitBatch).toHaveBeenCalledTimes(1));
  return (mockCommitBatch.mock.calls[0]![0] as { commands: Command[] })
    .commands;
}

function addedMetric(commands: Command[]): InsightMetric {
  const add = commands.find(
    (command) => (command.args as { metric?: InsightMetric }).metric,
  );
  expect(add).toBeDefined();
  return (add!.args as { metric: InsightMetric }).metric;
}

describe("ChartStarter", () => {
  beforeEach(() => {
    mockCommitBatch.mockReset();
    mockCommitBatch.mockResolvedValue(undefined);
    pointsState.mockReset();
    pointsState.mockReturnValue({ status: "ready", points: [] });
    retry.mockReset();
  });

  it("cannot pick a card before its aggregate confirms the fit", () => {
    pointsState.mockReturnValue({ status: "loading" });
    renderStarter();
    const card = screen.getByRole("button", { name: "Count by Category" });
    expect((card as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(card);
    expect(mockCommitBatch).not.toHaveBeenCalled();
  });

  it("drops a card that does not fit and hides the section when none is left", async () => {
    pointsState.mockImplementation((key: string) =>
      key.startsWith("count-by-category")
        ? { status: "unfit" }
        : { status: "ready", points: [] },
    );
    renderStarter();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Count by Category" })).toBe(
        null,
      ),
    );
    screen.getByRole("button", { name: "Total Sales by Category" });

    pointsState.mockReturnValue({ status: "unfit" });
    cleanup();
    renderStarter();
    await waitFor(() =>
      expect(screen.queryByText("Suggested charts")).toBe(null),
    );
    screen.getByText("Data preview");
  });

  it("shows each suggestion's name and the rule that produced it", () => {
    renderStarter();
    const rule = (name: string) => {
      const card = screen.getByRole("button", { name });
      const id = card.getAttribute("aria-describedby");
      return id ? document.getElementById(id)?.textContent : null;
    };
    expect(rule("Count by Category")).toBe("Few text values + row count → bar");
    expect(rule("Total Sales by Category")).toBe("Text + number → bar, sorted");
    expect(screen.getByText("sales_data · all 3 rows")).toBeTruthy();
  });

  it("writes a sorted bar's field, metric and sort in one batch", async () => {
    const { onPickChartType } = renderStarter();
    fireEvent.click(
      screen.getByRole("button", { name: "Total Sales by Category" }),
    );

    const commands = await committed();
    const metric = addedMetric(commands);
    expect(metric).toMatchObject({
      name: "Total Sales",
      aggregation: "sum",
      columnName: "Sales",
      sourceTable: TABLE_ID,
    });
    expect(commands).toContainEqual(
      cmd("SelectFields", { id: INSIGHT_ID, fieldIds: [CATEGORY.id] }),
    );
    expect(commands).toContainEqual(
      cmd("SetInsightSort", {
        id: INSIGHT_ID,
        sorts: [{ field: metricIdToColumnAlias(metric.id), direction: "desc" }],
      }),
    );
    expect(onPickChartType).toHaveBeenCalledWith("barX");
  });

  it("writes a row-count bar without a sort", async () => {
    const { onPickChartType } = renderStarter();
    fireEvent.click(screen.getByRole("button", { name: "Count by Category" }));

    const commands = await committed();
    expect(addedMetric(commands)).toMatchObject({
      name: "Count",
      aggregation: "count",
      columnName: undefined,
    });
    expect(commands).toContainEqual(
      cmd("SelectFields", { id: INSIGHT_ID, fieldIds: [CATEGORY.id] }),
    );
    const sortPath = cmd("SetInsightSort", { id: INSIGHT_ID, sorts: [] }).path;
    expect(commands.map((command) => command.path)).not.toContain(sortPath);
    expect(onPickChartType).toHaveBeenCalledWith("barY");
  });

  it("takes back the chart type when the write fails", async () => {
    mockCommitBatch.mockRejectedValueOnce(new Error("offline"));
    const { onPickChartType } = renderStarter();
    fireEvent.click(screen.getByRole("button", { name: "Count by Category" }));

    await waitFor(() =>
      expect(onPickChartType).toHaveBeenLastCalledWith(undefined),
    );
    expect(onPickChartType.mock.calls).toEqual([["barY"], [undefined]]);
  });

  it("adds a column as the grouping from its header menu", async () => {
    renderStarter();
    fireEvent.click(
      screen.getByRole("button", { name: "Category column actions" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Group by Category/ }),
    );

    expect(await committed()).toEqual([
      cmd("SelectFields", { id: INSIGHT_ID, fieldIds: [CATEGORY.id] }),
    ]);
  });

  it("adds a number column as a metric from its header menu", async () => {
    renderStarter({
      ...INSIGHT,
      selectedFields: [CATEGORY.id],
    } as Insight);
    fireEvent.click(
      screen.getByRole("button", { name: "Sales column actions" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Use as metric/ }),
    );

    expect(addedMetric(await committed())).toMatchObject({
      name: "Total Sales",
      aggregation: "sum",
      columnName: "Sales",
    });
  });

  it("offers no total for a ratio column from its header menu", async () => {
    renderStarter(
      { ...INSIGHT, selectedFields: [CATEGORY.id] } as Insight,
      vi.fn(),
      withSalesContract({ kind: "ratio" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Sales column actions" }),
    );
    const item = await screen.findByRole("menuitem", {
      name: /Use as metric/,
    });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(item.textContent).toContain("Sales can't be totalled");
    fireEvent.click(item);
    expect(mockCommitBatch).not.toHaveBeenCalled();
  });

  it("brings back a card that no longer fits once the source changes", async () => {
    pointsState.mockImplementation((key: string, revision: string) =>
      key.startsWith("count-by-category") && revision === "rev-1"
        ? { status: "unfit" }
        : { status: "ready", points: [] },
    );
    const { rerenderAt } = renderStarter();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Count by Category" })).toBe(
        null,
      ),
    );

    rerenderAt("rev-2");
    await screen.findByRole("button", { name: "Count by Category" });
  });

  it("offers a retry on a card whose preview failed", () => {
    pointsState.mockImplementation((key: string) =>
      key.startsWith("count-by-category")
        ? { status: "failed" }
        : { status: "ready", points: [] },
    );
    renderStarter();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Retry the preview of Count by Category",
      }),
    );
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("holds the header actions while a write is pending", async () => {
    let finish!: () => void;
    mockCommitBatch.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    renderStarter();
    fireEvent.click(screen.getByRole("button", { name: "Count by Category" }));
    await waitFor(() => expect(mockCommitBatch).toHaveBeenCalledTimes(1));

    fireEvent.click(
      screen.getByRole("button", { name: "Category column actions" }),
    );
    const item = await screen.findByRole("menuitem", {
      name: /Group by Category/,
    });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(item);
    expect(mockCommitBatch).toHaveBeenCalledTimes(1);
    finish();
  });
});

describe("chart starter metrics", () => {
  it("writes nothing when a ratio column is asked for a total", () => {
    const sales = FIELDS[1]!;
    expect(
      buildColumnActionCommands(
        INSIGHT,
        withSalesContract({ kind: "ratio" }),
        sales,
        "metric",
      ),
    ).toEqual([]);
  });

  it("never suggests summing a ratio measure", () => {
    const table = withSalesContract({ kind: "ratio" });
    expect(isPlainSumColumn(table, "Sales")).toBe(false);
    const suggestions = suggestChartStarters(FIELDS, ANALYSIS, ROWS.length, {
      canSum: (field) =>
        !!field.columnName && isPlainSumColumn(table, field.columnName),
    });
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every((s) => s.aggregation !== "sum")).toBe(true);
  });

  it("previews and saves the same metric, contract included", () => {
    const table = withSalesContract({ kind: "additive" });
    const sum = suggestChartStarters(FIELDS, ANALYSIS, ROWS.length).find(
      (s) => s.aggregation === "sum",
    )!;
    expect(chartStarterMetric(table, sum)).toMatchObject({
      aggregation: "sum",
      columnName: "Sales",
      contract: { kind: "additive" },
    });
  });
});

describe("thumbnailGeometry", () => {
  const points = (...values: number[]) =>
    values.map((value, index) => ({ label: `${index}`, value }));

  it("draws all-negative bars down from a zero baseline", () => {
    const geometry = thumbnailGeometry("barY", points(-5, -10))!;
    expect(geometry.zero).toBeDefined();
    const zeroY = geometry.zero!.y1;
    for (const rect of geometry.rects) {
      expect(rect.y).toBeCloseTo(zeroY);
      expect(rect.height).toBeGreaterThan(1);
    }
    expect(geometry.rects[1]!.height).toBeGreaterThan(
      geometry.rects[0]!.height,
    );
  });

  it("draws mixed signs on both sides of zero", () => {
    const geometry = thumbnailGeometry("barY", points(10, -10))!;
    const zeroY = geometry.zero!.y1;
    const [up, down] = geometry.rects as [
      (typeof geometry.rects)[number],
      (typeof geometry.rects)[number],
    ];
    expect(up.y + up.height).toBeCloseTo(zeroY);
    expect(down.y).toBeCloseTo(zeroY);
    expect(up.height).toBeCloseTo(down.height);
  });

  it("draws sideways bars left of zero for negatives", () => {
    const geometry = thumbnailGeometry("barX", points(4, -4))!;
    const zeroX = geometry.zero!.x1;
    expect(geometry.rects[0]!.x).toBeCloseTo(zeroX);
    expect(geometry.rects[1]!.x + geometry.rects[1]!.width).toBeCloseTo(zeroX);
  });

  it("keeps an all-negative line inside the frame", () => {
    const geometry = thumbnailGeometry("line", points(-1, -3, -2))!;
    const ys = geometry
      .line!.split(" ")
      .map((pair) => Number(pair.split(",")[1]));
    expect(new Set(ys).size).toBe(3);
    expect(Math.max(...ys)).toBeGreaterThan(geometry.zero!.y1);
  });

  it("adds no baseline for all-positive data", () => {
    expect(thumbnailGeometry("barY", points(1, 2))!.zero).toBeUndefined();
  });
});
