import { render, screen } from "@testing-library/react";
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
