import { nativeQueryMock } from "@/test/native-query-fixture";
/**
 * OpenChartButton — a draft's chart opens inside a report.
 *
 * - A chart on a report opens there, with no question asked.
 * - A chart on no report asks which report to place it on; the recent
 *   reports come newest first.
 * - A chart the draft creates does not exist yet: nothing to open.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { mockOpenChart, server } = vi.hoisted(() => ({
  mockOpenChart: vi.fn(),
  server: {
    dashboards: [] as unknown[],
    dashboardsFail: false,
    visualizations: [] as unknown[],
  },
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock((ref: { _path: string }) =>
    ref._path === "listDashboards" && server.dashboardsFail
      ? { isError: true }
      : {
          data: {
            listDashboards: server.dashboards,
            listVisualizations: server.visualizations,
          }[ref._path],
        },
  ),
}));
vi.mock("@/hooks/useOpenChartInReport", () => ({
  useOpenChartInReport: () => ({ openChart: mockOpenChart }),
}));

import { OpenChartButton } from "./OpenChartButton";

function report(id: string, name: string, updatedAt: number, charts: string[]) {
  return {
    id,
    name,
    createdAt: 0,
    updatedAt,
    items: charts.map((visualizationId, index) => ({
      id: `${id}-item-${index}`,
      type: "visualization",
      visualizationId,
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOpenChart.mockResolvedValue(true);
  server.dashboardsFail = false;
  server.visualizations = [{ id: "viz-1", name: "Revenue" }];
  server.dashboards = [
    report("older", "Older report", 1, ["viz-other"]),
    report("newer", "Newer report", 2, []),
  ];
});

describe("OpenChartButton", () => {
  it("opens a chart on a report there", () => {
    server.dashboards = [report("home", "Home report", 1, ["viz-1"])];
    render(<OpenChartButton visualizationId="viz-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Open chart" }));

    expect(mockOpenChart).toHaveBeenCalledWith(
      { kind: "existing", reportId: "home" },
      "viz-1",
      server.dashboards,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks which report a chart on no report goes on", async () => {
    render(<OpenChartButton visualizationId="viz-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Open chart" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Place Revenue on a report",
    });
    const rows = within(dialog).getAllByRole("option");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Newer report"),
      expect.stringContaining("Older report"),
    ]);
    expect(rows[1]!.textContent).toContain("1 chart");

    fireEvent.click(rows[1]!);
    expect(mockOpenChart).toHaveBeenCalledWith(
      { kind: "existing", reportId: "older" },
      "viz-1",
      server.dashboards,
    );
  });

  it("can place the chart on a new report", async () => {
    render(<OpenChartButton visualizationId="viz-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Open chart" }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: "New report" }));
    expect(mockOpenChart).toHaveBeenCalledWith(
      { kind: "new" },
      "viz-1",
      server.dashboards,
    );
  });

  it("offers nothing when the reports fail to load", () => {
    server.dashboardsFail = true;
    render(<OpenChartButton visualizationId="viz-1" />);
    expect(screen.queryByRole("button", { name: "Open chart" })).toBeNull();
  });

  it("offers nothing until the reports have loaded", () => {
    server.dashboards = undefined as never;
    render(<OpenChartButton visualizationId="viz-1" />);
    expect(screen.queryByRole("button", { name: "Open chart" })).toBeNull();
  });

  it("offers nothing for a chart that does not exist yet", () => {
    server.visualizations = [];
    render(<OpenChartButton visualizationId="viz-1" />);
    expect(screen.queryByRole("button", { name: "Open chart" })).toBeNull();
  });
});
