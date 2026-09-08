import type { DataPickerModalProps } from "@/components/data-sources/DataPickerModal";
import type { DataTable, Insight } from "@dashframe/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { mockNavigate } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/components/data-sources/DataPickerModal", () => ({
  DataPickerModal: (props: DataPickerModalProps) => (
    <div>
      <span>{props.showInsights ? "insights enabled" : "tables only"}</span>
      {props.onInsightSelect ? (
        <button type="button">Choose insight</button>
      ) : null}
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

  it("offers only supported table targets and keeps report context", () => {
    const onOpenChange = vi.fn();

    render(
      <JoinFlowModal
        insight={{ id: "insight-a" } as Insight}
        dataTable={{ id: "table-a" } as DataTable}
        isOpen
        onOpenChange={onOpenChange}
        reportId="report-b"
      />,
    );

    expect(screen.getByText("tables only")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Choose insight" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Choose table" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/insights/insight-a/join/table-b",
      search: { reportId: "report-b" },
    });
  });
});
