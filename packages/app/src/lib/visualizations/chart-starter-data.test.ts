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

const { requestHost, queryDataFrame } = vi.hoisted(() => ({
  requestHost: vi.fn(),
  queryDataFrame: vi.fn(),
}));
vi.mock("@/data/host", () => ({ requestHost }));
vi.mock("@/lib/data-access/data-frames", () => ({ queryDataFrame }));

import type { Field, Insight, UUID } from "@dashframe/types";
import type { ChartStarterSuggestion } from "./chart-starter";
import {
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

beforeEach(() => {
  requestHost.mockReset();
  queryDataFrame.mockReset();
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

    const aggregate = await fetchChartStarterAggregate(INSIGHT, sortedBar);

    expect(requestHost).toHaveBeenCalledWith("fetchData", {
      insight: expect.objectContaining({
        baseTableId: TABLE_ID,
        selectedFields: [REGION.id],
        metrics: [
          expect.objectContaining({ aggregation: "sum", columnName: "Sales" }),
        ],
      }),
      presentation: { dimensions: [REGION.id] },
    });
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

    const aggregate = await fetchChartStarterAggregate(INSIGHT, line);

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
      useChartStarterPoints(INSIGHT, countBar, "rev-unfit"),
    );
    await waitFor(() => expect(result.current.status).toBe("unfit"));
  });

  it("retries a failed query on the next mount", async () => {
    requestHost.mockRejectedValueOnce(new Error("offline"));
    const first = renderHook(() =>
      useChartStarterPoints(INSIGHT, countBar, "rev-retry"),
    );
    await waitFor(() => expect(first.result.current.status).toBe("failed"));
    first.unmount();

    hostReturns();
    queryDataFrame.mockResolvedValue(page([["North", 2]]));
    const second = renderHook(() =>
      useChartStarterPoints(INSIGHT, countBar, "rev-retry"),
    );
    await waitFor(() =>
      expect(second.result.current).toEqual({
        status: "ready",
        points: [{ label: "North", value: 2 }],
      }),
    );
  });
});
