import type {
  ColumnAnalysis,
  DataTable,
  UUID,
  Visualization,
} from "@dashframe/types";
import { fieldEncoding } from "@dashframe/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { useVisualizationEncodingChange } from "./useVisualizationEncodingChange";

const visualizationId = "11111111-1111-4111-8111-111111111111" as UUID;
const fieldId = "22222222-2222-4222-8222-222222222222" as UUID;
const tableId = "33333333-3333-4333-8333-333333333333" as UUID;
const fieldAlias = "field_22222222_2222_4222_8222_222222222222";

const visualization: Pick<Visualization, "id" | "encoding"> = {
  id: visualizationId,
  encoding: { y: "metric:existing" },
};
const dataTable: Pick<DataTable, "fields"> = {
  fields: [
    {
      id: fieldId,
      tableId,
      name: "Revenue",
      columnName: "revenue",
      type: "number",
    },
  ],
};
const analysis: ColumnAnalysis[] = [
  {
    columnName: fieldAlias,
    fieldId,
    dataType: "number",
    semantic: "numerical",
    cardinality: 20,
    uniqueness: 1,
    nullCount: 0,
    sampleValues: [10, 20],
    min: 10,
    max: 20,
  },
];

function EncodingHarness({
  updateVisualization,
}: {
  updateVisualization: ReturnType<typeof vi.fn>;
}) {
  const changeEncoding = useVisualizationEncodingChange({
    visualization,
    dataTable,
    columnAnalysis: analysis,
    updateVisualization,
  });
  return (
    <button
      type="button"
      onClick={() => changeEncoding("x", fieldEncoding(fieldId))}
    >
      Set X
    </button>
  );
}

describe("useVisualizationEncodingChange", () => {
  it("writes saved encoding edits with the analyzed axis type", async () => {
    const updateVisualization = vi.fn().mockResolvedValue(undefined);
    render(<EncodingHarness updateVisualization={updateVisualization} />);

    fireEvent.click(screen.getByRole("button", { name: "Set X" }));

    await waitFor(() =>
      expect(updateVisualization).toHaveBeenCalledWith({
        id: visualizationId,
        updates: {
          encoding: {
            y: "metric:existing",
            x: fieldEncoding(fieldId),
            xType: "quantitative",
          },
        },
      }),
    );
  });
});
