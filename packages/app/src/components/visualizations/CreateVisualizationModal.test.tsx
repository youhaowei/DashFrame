import type { DataPickerContentProps } from "@/components/data-sources/DataPickerContent";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const {
  mockCreateInsightFromTable,
  mockCreateInsightFromInsight,
  mockNavigate,
  mockObserveTableSelection,
} = vi.hoisted(() => ({
  mockCreateInsightFromTable: vi.fn(),
  mockCreateInsightFromInsight: vi.fn(),
  mockNavigate: vi.fn(),
  mockObserveTableSelection: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/hooks/useCreateInsight", () => ({
  useCreateInsight: () => ({
    createInsightFromTable: mockCreateInsightFromTable,
    createInsightFromInsight: mockCreateInsightFromInsight,
  }),
}));

vi.mock("@/components/data-sources/DataPickerModal", () => ({
  DataPickerModal: ({ onTableSelect }: DataPickerContentProps) => (
    <button
      onClick={() =>
        mockObserveTableSelection(onTableSelect("table-a", "Table A"))
      }
    >
      Choose table
    </button>
  ),
}));

import { CreateVisualizationModal } from "./CreateVisualizationModal";

describe("CreateVisualizationModal", () => {
  beforeEach(() => {
    mockCreateInsightFromTable.mockReset();
    mockCreateInsightFromInsight.mockReset();
    mockNavigate.mockReset();
    mockObserveTableSelection.mockReset();
  });

  it("keeps the picker open when question creation returns null", async () => {
    const onClose = vi.fn();
    mockCreateInsightFromTable.mockResolvedValue(null);

    render(<CreateVisualizationModal isOpen onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose table" }));

    await waitFor(() => expect(mockCreateInsightFromTable).toHaveBeenCalled());
    await expect(
      mockObserveTableSelection.mock.calls[0]?.[0],
    ).resolves.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes the picker after question creation succeeds", async () => {
    const onClose = vi.fn();
    mockCreateInsightFromTable.mockResolvedValue("insight-a");

    render(<CreateVisualizationModal isOpen onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose table" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
});
