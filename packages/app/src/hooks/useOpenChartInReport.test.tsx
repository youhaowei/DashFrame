import { nativeMutationMock } from "@/test/native-query-fixture";
/**
 * useOpenChartInReport — every way into a chart lands on a report.
 *
 * - startChart opens the report on a new chart tab of the table; a report
 *   made for a chart that could not start is deleted again.
 * - openChart places a chart on the report when it is not there yet, then
 *   opens its tab; a failed placement toasts and stays put.
 */
import type { Dashboard } from "@dashframe/types";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const {
  mockCommitBatch,
  mockCreateChartInsight,
  mockNavigate,
  mockToastError,
} = vi.hoisted(() => ({
  mockCommitBatch: vi.fn(),
  mockCreateChartInsight: vi.fn(),
  mockNavigate: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useMutation: nativeMutationMock(() => ({ mutateAsync: mockCommitBatch })),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));
vi.mock("@/hooks/useCreateInsight", () => ({
  useCreateInsight: () => ({ createChartInsight: mockCreateChartInsight }),
}));
vi.mock("sonner", () => ({ toast: { error: mockToastError } }));

import { useReportChartTabs } from "@/lib/reports/chart-tabs";
import { useOpenChartInReport } from "./useOpenChartInReport";

type Command = { path: string; args: Record<string, unknown> };
const TABLE = { id: "table-1", name: "orders" };

function sentCommands(): Command[] {
  return mockCommitBatch.mock.calls.flatMap(
    ([batch]) => (batch as { commands: Command[] }).commands,
  );
}

function hook() {
  return renderHook(() => useOpenChartInReport()).result;
}

beforeEach(() => {
  vi.clearAllMocks();
  useReportChartTabs.setState(useReportChartTabs.getInitialState());
  mockCommitBatch.mockResolvedValue({});
  mockCreateChartInsight.mockResolvedValue("insight");
  mockNavigate.mockResolvedValue(undefined);
});

describe("startChart", () => {
  it("opens an existing report on a new chart tab of the table", async () => {
    const result = hook();
    let opened: boolean | undefined;
    await act(async () => {
      opened = await result.current.startChart(
        { kind: "existing", reportId: "report-1" },
        TABLE,
      );
    });

    expect(opened).toBe(true);
    expect(sentCommands()).toEqual([]);
    expect(mockCreateChartInsight).toHaveBeenCalledWith(
      "table-1",
      "orders",
      expect.any(String),
    );
    const [tab] = useReportChartTabs.getState().tabsByReport["report-1"] ?? [];
    expect(tab?.insightId).toBe(mockCreateChartInsight.mock.calls[0]![2]);
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/dashboards/report-1",
      search: { chart: tab?.id },
    });
  });

  it("creates the new report before the chart", async () => {
    const result = hook();
    await act(async () => {
      await result.current.startChart({ kind: "new" }, TABLE);
    });

    const [create] = sentCommands();
    expect(create).toMatchObject({
      path: "createDashboardCmd",
      args: { name: "Untitled report" },
    });
    expect(mockCommitBatch.mock.invocationCallOrder[0]).toBeLessThan(
      mockCreateChartInsight.mock.invocationCallOrder[0]!,
    );
    expect(mockNavigate).toHaveBeenCalledWith({
      to: `/dashboards/${create!.args.id}`,
      search: { chart: expect.any(String) },
    });
  });

  it("deletes a report made for a chart that could not start", async () => {
    mockCreateChartInsight.mockResolvedValue(null);
    const result = hook();
    let opened: boolean | undefined;
    await act(async () => {
      opened = await result.current.startChart({ kind: "new" }, TABLE);
    });

    expect(opened).toBe(false);
    const [create, remove] = sentCommands();
    expect(remove).toEqual({
      path: "deleteNode",
      args: { id: create!.args.id },
    });
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(
      Object.values(useReportChartTabs.getState().tabsByReport).flat(),
    ).toEqual([]);
  });

  it("keeps an existing report when its chart could not start", async () => {
    mockCreateChartInsight.mockResolvedValue(null);
    const result = hook();
    await act(async () => {
      await result.current.startChart(
        { kind: "existing", reportId: "report-1" },
        TABLE,
      );
    });
    expect(sentCommands()).toEqual([]);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("starts one chart when asked twice at once", async () => {
    const result = hook();
    let second: boolean | undefined;
    await act(async () => {
      const first = result.current.startChart(
        { kind: "existing", reportId: "report-1" },
        TABLE,
      );
      second = await result.current.startChart(
        { kind: "existing", reportId: "report-1" },
        TABLE,
      );
      await first;
    });
    expect(second).toBe(false);
    expect(mockCreateChartInsight).toHaveBeenCalledTimes(1);
  });

  it("stops with a toast when the new report cannot be created", async () => {
    mockCommitBatch.mockRejectedValue(new Error("offline"));
    const result = hook();
    let opened: boolean | undefined;
    await act(async () => {
      opened = await result.current.startChart({ kind: "new" }, TABLE);
    });
    expect(opened).toBe(false);
    expect(mockToastError).toHaveBeenCalledWith("Couldn't start a report");
    expect(mockCreateChartInsight).not.toHaveBeenCalled();
  });
});

describe("openChart", () => {
  const report = {
    id: "report-1",
    items: [
      {
        id: "item-1",
        type: "visualization",
        visualizationId: "viz-on-report",
        x: 0,
        y: 0,
        width: 6,
        height: 4,
      },
    ],
  } as unknown as Pick<Dashboard, "id" | "items">;

  it("opens a chart already on the report without placing it again", async () => {
    const result = hook();
    await act(async () => {
      await result.current.openChart(
        { kind: "existing", reportId: "report-1" },
        "viz-on-report",
        [report],
      );
    });
    expect(sentCommands()).toEqual([]);
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/dashboards/report-1",
      search: { chart: "viz-on-report" },
    });
  });

  it("places a chart below the report's items, then opens it", async () => {
    const result = hook();
    await act(async () => {
      await result.current.openChart(
        { kind: "existing", reportId: "report-1" },
        "viz-2",
        [report],
      );
    });
    expect(sentCommands()).toEqual([
      {
        path: "addDashboardItemCmd",
        args: {
          dashboardId: "report-1",
          item: expect.objectContaining({ visualizationId: "viz-2", y: 4 }),
        },
      },
    ]);
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/dashboards/report-1",
      search: { chart: "viz-2" },
    });
  });

  it("creates a new report and places the chart on it in one batch", async () => {
    const result = hook();
    await act(async () => {
      await result.current.openChart({ kind: "new" }, "viz-2", [report]);
    });
    expect(mockCommitBatch).toHaveBeenCalledTimes(1);
    const [create, add] = sentCommands();
    expect(create?.path).toBe("createDashboardCmd");
    expect(add?.args.dashboardId).toBe(create!.args.id);
  });

  it("refuses a report that no longer exists instead of making a new one", async () => {
    const result = hook();
    let opened: boolean | undefined;
    await act(async () => {
      opened = await result.current.openChart(
        { kind: "existing", reportId: "gone" },
        "viz-2",
        [report],
      );
    });
    expect(opened).toBe(false);
    expect(sentCommands()).toEqual([]);
    expect(mockToastError).toHaveBeenCalledWith(
      "That report no longer exists. Pick another one.",
    );
  });

  it("stays put with a toast when the chart cannot be placed", async () => {
    mockCommitBatch.mockRejectedValue(new Error("offline"));
    const result = hook();
    let opened: boolean | undefined;
    await act(async () => {
      opened = await result.current.openChart(
        { kind: "existing", reportId: "report-1" },
        "viz-2",
        [report],
      );
    });
    expect(opened).toBe(false);
    expect(mockToastError).toHaveBeenCalledWith(
      "Couldn't place the chart on the report",
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
