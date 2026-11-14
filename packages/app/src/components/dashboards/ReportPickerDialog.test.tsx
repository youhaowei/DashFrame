import { nativeQueryMocks } from "@/test/native-query-fixture";
/**
 * ReportPickerDialog — which report a chart goes on.
 *
 * - Recent reports come newest first, each picked by its id.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { server } = vi.hoisted(() => ({
  server: { reports: [] as unknown[] },
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  ...nativeQueryMocks(() => ({ data: server.reports })),
}));

import { ReportPickerDialog } from "./ReportPickerDialog";

function report(id: string, name: string, updatedAt: number) {
  return { id, name, createdAt: 0, updatedAt, items: [] };
}

beforeEach(() => {
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
});
