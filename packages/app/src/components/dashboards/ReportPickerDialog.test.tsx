import { nativeQueryMock } from "@/test/native-query-fixture";
/**
 * ReportPickerDialog — which report a chart goes on.
 *
 * - Recent reports come newest first, each picked by its id.
 * - When the reports fail to load it says so, and a new report can still be
 *   started.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { server } = vi.hoisted(() => ({
  server: { reports: [] as unknown[], fail: false },
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock(() =>
    server.fail ? { isError: true } : { data: server.reports },
  ),
}));

import { ReportPickerDialog } from "./ReportPickerDialog";

function report(id: string, name: string, updatedAt: number) {
  return { id, name, createdAt: 0, updatedAt, items: [] };
}

beforeEach(() => {
  server.fail = false;
  server.reports = [report("old", "Old", 1), report("new", "New one", 2)];
});

function renderPicker(onPick = vi.fn()) {
  render(
    <ReportPickerDialog
      isOpen
      onClose={vi.fn()}
      title="Chart orders"
      onPick={onPick}
    />,
  );
  return onPick;
}

describe("ReportPickerDialog", () => {
  it("offers recent reports newest first", () => {
    const onPick = renderPicker();
    const rows = screen.getAllByRole("option");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("New one"),
      expect.stringContaining("Old"),
    ]);
    fireEvent.click(rows[1]!);
    expect(onPick).toHaveBeenCalledWith({ kind: "existing", reportId: "old" });
  });

  it("says when reports fail to load and still offers a new report", () => {
    server.fail = true;
    const onPick = renderPicker();
    expect(screen.getByRole("alert").textContent).toBe(
      "Couldn't load your reports. You can still start a new one.",
    );
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "New report" }));
    expect(onPick).toHaveBeenCalledWith({ kind: "new" });
  });
});
