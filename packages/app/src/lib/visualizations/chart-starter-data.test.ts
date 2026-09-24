/**
 * The aggregate behind a suggested-chart card.
 *
 * - It asks the host for the suggestion's metric grouped by its field, with a
 *   presentation, so the host reads published data instead of the source.
 * - A sorted bar reads its largest groups first; a line reads every date, a
 *   page at a time, in date order.
 * - The card drops itself when the table has more groups than its rule allows
 *   (the rules only saw a sample), and a failed query is retried on the next
 *   mount rather than cached.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { requestHost, queryDataFrame, removeDataFrame } = vi.hoisted(() => ({
  requestHost: vi.fn(),
  queryDataFrame: vi.fn(),
  removeDataFrame: vi.fn(),
}));
vi.mock("@/data/host", () => ({ requestHost }));
vi.mock("@/lib/data-access/data-frames", () => ({
  queryDataFrame,
  removeDataFrame,
}));

import type { Field, Insight, InsightMetric, UUID } from "@dashframe/types";
import { act } from "react";
import type { ChartStarterSuggestion } from "./chart-starter";
import {
  CHART_STARTER_CACHE_LIMIT,
  fetchChartStarterAggregate,
  useChartStarterPoints,
} from "./chart-starter-data";

const TABLE_ID = "30000000-0000-4000-8000-000000000000" as UUID;
const field = (id: string, name: string, type: Field["type"]): Field => ({
  id: id as UUID,
  name,
  columnName: name,
  tableId: TABLE_ID,
  type,
});
const REGION = field(
  "30000000-0000-4000-8000-000000000001",
  "Region",
  "string",
);
const DAY = field("30000000-0000-4000-8000-000000000002", "Day", "date");
const SALES = field("30000000-0000-4000-8000-000000000003", "Sales", "number");

const INSIGHT = {
  source: { sourceType: "dataTable", sourceId: TABLE_ID },
  filters: [],
  joins: [],
} as unknown as Pick<Insight, "source" | "filters" | "joins">;

const GROUP_COLUMN = "field_30000000_0000_4000_8000_000000000001";
const METRIC_COLUMN = "metric_value";

function hostReturns(groupColumn = GROUP_COLUMN) {
  requestHost.mockResolvedValue({
    status: "ready",
    dataFrameId: "frame-1",
    schema: [
      { id: groupColumn, name: "group", type: "string" },
      { id: METRIC_COLUMN, name: "value", type: "number" },
    ],
  });
}

function page(rows: [unknown, number][], totalCount = rows.length) {
  return {
    status: "ready",
    schema: [],
    totalCount,
    page: { offset: 0, limit: rows.length, returned: rows.length },
    rows: rows.map(([group, value]) => ({
      [GROUP_COLUMN]: group,
      [METRIC_COLUMN]: value,
    })),
  };
}

const sortedBar: ChartStarterSuggestion = {
  key: "sum-sorted:region:sales",
  rule: "sum-sorted",
  chartType: "barX",
  group: REGION,
  aggregation: "sum",
  measure: SALES,
  sortByValue: true,
};
const countBar: ChartStarterSuggestion = {
  key: "count-by-category:region",
  rule: "count-by-category",
  chartType: "barY",
  group: REGION,
  aggregation: "count",
  sortByValue: false,
};
const line: ChartStarterSuggestion = {
  key: "line-over-time:day:sales",
  rule: "line-over-time",
  chartType: "line",
  group: DAY,
  aggregation: "sum",
  measure: SALES,
  sortByValue: false,
};

const metricFor = (suggestion: ChartStarterSuggestion): InsightMetric => ({
  id: "30000000-0000-4000-8000-0000000000ff" as UUID,
  name: "Total Sales",
  sourceTable: TABLE_ID,
  columnName: suggestion.measure?.columnName,
  aggregation: suggestion.aggregation,
});

beforeEach(() => {
  requestHost.mockReset();
  queryDataFrame.mockReset();
  removeDataFrame.mockReset();
  removeDataFrame.mockResolvedValue(undefined);
});

describe("fetchChartStarterAggregate", () => {
  it("groups the metric by the field and reads published data", async () => {
    hostReturns();
    queryDataFrame.mockResolvedValue(
      page([
        ["North", 30],
        ["South", 10],
      ]),
    );

    const aggregate = await fetchChartStarterAggregate(
      INSIGHT,
      sortedBar,
      metricFor(sortedBar),
    );

    expect(requestHost).toHaveBeenCalledWith("fetchData", {
      insight: expect.objectContaining({
        baseTableId: TABLE_ID,
        selectedFields: [REGION.id],
        metrics: [
          expect.objectContaining({ aggregation: "sum", columnName: "Sales" }),
        ],
      }),
      presentation: { dimensions: [REGION.id] },
      exclusive: true,
    });
    // The frame is the card's alone, so it is removed once read.
    expect(removeDataFrame).toHaveBeenCalledWith("frame-1");
    expect(queryDataFrame).toHaveBeenCalledWith("frame-1", {
      offset: 0,
      limit: 12,
      sort: [{ fieldId: METRIC_COLUMN, direction: "desc" }],
    });
    expect(aggregate).toEqual({
      groups: 2,
      points: [
        { label: "North", value: 30 },
        { label: "South", value: 10 },
      ],
    });
  });

  it("reads a line's every date in date order, a page at a time", async () => {
    hostReturns();
    const firstPage = Array.from(
      { length: 500 },
      (_, index): [unknown, number] => [`d${index}`, index],
    );
    queryDataFrame
      .mockResolvedValueOnce(page(firstPage, 520))
      .mockResolvedValueOnce(
        page(
          Array.from({ length: 20 }, (_, index): [unknown, number] => [
            `e${index}`,
            index,
          ]),
          520,
        ),
      );

    const aggregate = await fetchChartStarterAggregate(
      INSIGHT,
      line,
      metricFor(line),
    );

    expect(queryDataFrame.mock.calls.map(([, options]) => options)).toEqual([
      {
        offset: 0,
        limit: 500,
        sort: [{ fieldId: GROUP_COLUMN, direction: "asc" }],
      },
      {
        offset: 500,
        limit: 500,
        sort: [{ fieldId: GROUP_COLUMN, direction: "asc" }],
      },
    ]);
    expect(aggregate.points).toHaveLength(520);
  });

  it("releases the result frame when reading it fails", async () => {
    hostReturns();
    queryDataFrame.mockResolvedValue({
      status: "failed",
      code: "X",
      message: "gone",
    });
    await expect(
      fetchChartStarterAggregate(INSIGHT, countBar, metricFor(countBar)),
    ).rejects.toThrow("gone");
    expect(removeDataFrame).toHaveBeenCalledWith("frame-1");
  });

  it("sends the metric the pick would save, contract included", async () => {
    hostReturns();
    queryDataFrame.mockResolvedValue(page([["North", 1]]));
    const metric = {
      ...metricFor(sortedBar),
      contract: { kind: "additive" as const },
    };
    await fetchChartStarterAggregate(INSIGHT, sortedBar, metric);
    expect(requestHost.mock.calls[0]![1].insight.metrics).toEqual([metric]);
  });
});

describe("useChartStarterPoints", () => {
  it("drops a card whose table has more groups than its rule allows", async () => {
    hostReturns();
    queryDataFrame.mockResolvedValue(
      page(
        Array.from({ length: 12 }, (_, index): [unknown, number] => [
          `c${index}`,
          1,
        ]),
        800,
      ),
    );

    const { result } = renderHook(() =>
      useChartStarterPoints(
        INSIGHT,
        countBar,
        "rev-unfit",
        metricFor(countBar),
      ),
    );
    await waitFor(() => expect(result.current.status).toBe("unfit"));
  });

  it("retries a failed query without remounting", async () => {
    requestHost.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() =>
      useChartStarterPoints(
        INSIGHT,
        countBar,
        "rev-retry",
        metricFor(countBar),
      ),
    );
    await waitFor(() => expect(result.current.status).toBe("failed"));

    hostReturns();
    queryDataFrame.mockResolvedValue(page([["North", 2]]));
    act(() => result.current.retry());
    await waitFor(() =>
      expect(result.current).toMatchObject({
        status: "ready",
        points: [{ label: "North", value: 2 }],
      }),
    );
  });

  it("keeps a bounded number of aggregates, dropping the least recent", async () => {
    hostReturns();
    queryDataFrame.mockResolvedValue(page([["North", 1]]));
    const load = async (revision: string) => {
      const { result, unmount } = renderHook(() =>
        useChartStarterPoints(INSIGHT, countBar, revision, metricFor(countBar)),
      );
      await waitFor(() => expect(result.current.status).toBe("ready"));
      unmount();
    };
    for (let index = 0; index <= CHART_STARTER_CACHE_LIMIT; index++)
      await load(`rev-bound-${index}`);
    const asked = requestHost.mock.calls.length;

    // The newest is still cached; the oldest was dropped and is asked again.
    await load(`rev-bound-${CHART_STARTER_CACHE_LIMIT}`);
    expect(requestHost.mock.calls.length).toBe(asked);
    await load("rev-bound-0");
    expect(requestHost.mock.calls.length).toBe(asked + 1);
  });
});
