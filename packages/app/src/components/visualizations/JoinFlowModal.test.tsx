import type { DataPickerModalProps } from "@/components/data-sources/DataPickerModal";
import type { DataTable, Insight } from "@dashframe/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { mockNavigate } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  // Opened from a chart tab in a report.
  useParams: () => ({ dashboardId: "report-b" }),
  useSearch: () => ({ chart: "chart-c" }),
}));

vi.mock("@/components/data-sources/DataPickerModal", () => ({
  DataPickerModal: (props: DataPickerModalProps) => (
    <div>
      <button
        type="button"
        onClick={() => props.onTableSelect?.("table-b", "Table B")}
      >
        Choose table
      </button>
    </div>
  ),
}));

import { JoinFlowModal } from "./JoinFlowModal";

describe("JoinFlowModal", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
  });

  it("offers only table targets and returns to the report's chart tab", () => {
    const onOpenChange = vi.fn();

    render(
      <JoinFlowModal
        insight={{ id: "insight-a" } as Insight}
        dataTable={{ id: "table-a" } as DataTable}
        isOpen
        onOpenChange={onOpenChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose table" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/dashboards/report-b/join/insight-a/table-b",
      search: { chart: "chart-c" },
    });
  });
});
