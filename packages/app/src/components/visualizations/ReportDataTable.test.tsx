import { render, screen, within } from "@testing-library/react";
import type { Insight } from "@dashframe/types";
import type { VirtualTableColumnConfig } from "@dashframe/ui";
import { describe, expect, it, vi } from "vite-plus/test";
import { ReportDataTable } from "./ReportDataTable";

vi.mock("@dashframe/ui", () => ({
  VirtualTable: ({
    rows,
    columnConfigs,
  }: {
    rows: Record<string, unknown>[];
    columnConfigs: VirtualTableColumnConfig[];
  }) => (
    <table>
      <thead>
        <tr>
          {columnConfigs.map((column) => (
            <th key={column.id} data-column-width={column.width}>
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index}>
            {columnConfigs.map((column) => (
              <td key={column.id}>
                {column.format?.(row[column.id]) ??
                  String(row[column.id] ?? "")}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));
vi.mock("@wystack/ui-react", () => ({
  ErrorState: ({
    title,
    description,
  }: {
    title: string;
    description: string;
  }) => (
    <div role="alert">
      {title}: {description}
    </div>
  ),
  Spinner: () => <span>Loading</span>,
}));
const insight: Insight = {
  id: "report",
  name: "Report",
  source: { sourceType: "dataTable", sourceId: "source" },
  selectedFields: ["country"],
  metrics: [
    {
      id: "rate",
      name: "Conversion",
      sourceTable: "source",
      aggregation: "count",
      format: { style: "percent", decimals: 1 },
    },
  ],
  reporting: { totals: true },
  createdAt: 0,
};
describe("ReportDataTable", () => {
  it("loads all pages and renders the canonical weighted total without summing or averaging cells", async () => {
    const fetchData = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          { field_country: "US", metric_rate: 0.5, __report_grouping: 0 },
          { field_country: "CA", metric_rate: 0.2, __report_grouping: 0 },
        ],
        totalCount: 3,
      })
      .mockResolvedValueOnce({
        rows: [
          { field_country: null, metric_rate: 0.25, __report_grouping: 1 },
        ],
        totalCount: 3,
      });
    render(
      <ReportDataTable
        insight={insight}
        fetchData={fetchData}
        totalCount={3}
        columnDisplayNames={{ field_country: "Country" }}
      />,
    );
    expect(await screen.findAllByText("25.0%")).toHaveLength(2);
    expect(screen.getByText("Total")).toBeTruthy();
    expect(screen.getByText("50.0%")).toBeTruthy();
    expect(fetchData).toHaveBeenNthCalledWith(2, { offset: 2, limit: 1 });
  });
  it("shows an error instead of rendering a partial report after a page fails", async () => {
    const fetchData = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ field_country: "US", metric_rate: 0.5 }],
        totalCount: 2,
      })
      .mockResolvedValueOnce({ rows: [], totalCount: 0 });
    render(
      <ReportDataTable
        insight={insight}
        fetchData={fetchData}
        totalCount={2}
        columnDisplayNames={{}}
      />,
    );
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

it.each([false, true])(
  "formats Arrow timestamps as UTC months (pivot=%s)",
  async (pivot) => {
    const fetchData = vi.fn().mockResolvedValue({
      rows: [{ field_date: Date.UTC(2026, 0, 1), metric_rate: 0.25 }],
      totalCount: 1,
    });
    render(
      <ReportDataTable
        insight={{
          ...insight,
          selectedFields: ["date"],
          reporting: {
            dateGrains: { date: "month" },
            pivotFields: pivot ? ["date"] : [],
          },
        }}
        fetchData={fetchData}
        totalCount={1}
        columnDisplayNames={{ field_date: "Month" }}
      />,
    );
    expect(
      await screen.findByText(pivot ? "2026-01 · Conversion" : "2026-01"),
    ).toBeTruthy();
    expect(screen.queryByText(String(Date.UTC(2026, 0, 1)))).toBeNull();
  },
);

it("keeps pivot table and KPI comparisons on the same weighted grand total", async () => {
  const comparative: Insight = {
    ...insight,
    selectedFields: ["date", "channel"],
    metrics: [
      ...insight.metrics,
      {
        id: "visits",
        name: "Visits dependency",
        sourceTable: "source",
        aggregation: "count",
      },
    ],
    reporting: {
      totals: true,
      pivotFields: ["channel"],
      dateGrains: { date: "month" },
      measureIds: ["rate"],
      comparison: "previous_period",
    },
  };
  const rows = [
    {
      field_date: Date.UTC(2026, 1, 1),
      field_channel: "Web",
      metric_rate: 0.5,
      __report_grouping: 0,
    },
    {
      field_date: Date.UTC(2026, 1, 1),
      field_channel: "Store",
      metric_rate: 0.05,
      __report_grouping: 0,
    },
    {
      field_date: null,
      field_channel: null,
      __report_grouping: 3,
      metric_rate: 0.1,
      metric_rate_previous: 0.08,
      metric_rate_change: 0.02,
      metric_rate_change_percent: 25,
      metric_visits: 100,
    },
  ];
  render(
    <ReportDataTable
      insight={comparative}
      fetchData={vi.fn().mockResolvedValue({ rows, totalCount: rows.length })}
      totalCount={rows.length}
      columnDisplayNames={{ field_date: "Month" }}
    />,
  );
  const table = await screen.findByRole("table");
  const kpis = screen.getByLabelText("Report totals");
  expect(within(kpis).getByText("10.0%")).toBeTruthy();
  expect(within(kpis).getByText("Previous: 8.0%")).toBeTruthy();
  expect(within(kpis).getByText("Change: 2.0 pp · 25.0%")).toBeTruthy();
  for (const value of ["10.0%", "8.0%", "2.0 pp", "25.0%"])
    expect(within(table).getByText(value)).toBeTruthy();
  const headers = within(table).getAllByRole("columnheader");
  expect(headers[0]?.getAttribute("data-column-width")).toBe("140");
  expect(
    headers
      .slice(1)
      .every((header) => header.getAttribute("data-column-width") === "180"),
  ).toBe(true);
  expect(screen.queryByText("Visits dependency")).toBeNull();
  expect(screen.queryByText("27.5%")).toBeNull();
});
