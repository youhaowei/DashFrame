import type { DataPickerContentProps } from "@/components/data-sources/DataPickerContent";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const {
  mockCreateInsightFromTable,
  mockCreateInsightFromInsight,
  mockObserveTableSelection,
} = vi.hoisted(() => ({
  mockCreateInsightFromTable: vi.fn(),
  mockCreateInsightFromInsight: vi.fn(),
  mockObserveTableSelection: vi.fn(),
}));

vi.mock("@/hooks/useCreateInsight", () => ({
  useCreateInsight: () => ({
    createInsightFromTable: mockCreateInsightFromTable,
    createInsightFromInsight: mockCreateInsightFromInsight,
  }),
}));

vi.mock("@/components/data-sources/DataPickerContent", () => ({
  DataPickerContent: ({ onTableSelect }: DataPickerContentProps) => (
    <button
      type="button"
      onClick={() =>
        mockObserveTableSelection(onTableSelect("table-a", "Table A"))
      }
    >
      Choose table
    </button>
  ),
}));

import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  beforeEach(() => {
    mockCreateInsightFromTable.mockReset();
    mockCreateInsightFromInsight.mockReset();
    mockObserveTableSelection.mockReset();
  });

  it("keeps selection active when question creation returns null", async () => {
    const onCreateClick = vi.fn();
    mockCreateInsightFromTable.mockResolvedValue(null);

    render(<EmptyState onCreateClick={onCreateClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose table" }));

    await waitFor(() => expect(mockCreateInsightFromTable).toHaveBeenCalled());
    await expect(
      mockObserveTableSelection.mock.calls[0]?.[0],
    ).resolves.toBeNull();
    expect(onCreateClick).not.toHaveBeenCalled();
  });

  it("continues after question creation succeeds", async () => {
    const onCreateClick = vi.fn();
    mockCreateInsightFromTable.mockResolvedValue("insight-a");

    render(<EmptyState onCreateClick={onCreateClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose table" }));

    await waitFor(() => expect(onCreateClick).toHaveBeenCalledOnce());
  });
});
