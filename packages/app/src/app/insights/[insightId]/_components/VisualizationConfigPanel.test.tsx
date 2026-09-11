import type {
  ColumnAnalysis,
  CompiledInsight,
  DataTable,
  Field,
  UUID,
  Visualization,
} from "@dashframe/types";
import { fieldEncoding } from "@dashframe/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/components/visualizations/AxisSelectField", () => ({
  AxisSelectField: ({
    axis,
    onChange,
  }: {
    axis: "x" | "y";
    onChange: (value: string) => void;
  }) => (
    <button type="button" onClick={() => onChange(fieldEncoding(fieldId))}>
      Set {axis.toUpperCase()} encoding
    </button>
  ),
}));

import { VisualizationConfigPanel } from "./VisualizationConfigPanel";

const visualizationId = "11111111-1111-4111-8111-111111111111" as UUID;
const insightId = "22222222-2222-4222-8222-222222222222" as UUID;
const tableId = "33333333-3333-4333-8333-333333333333" as UUID;
const fieldId = "44444444-4444-4444-8444-444444444444" as UUID;
const fieldAlias = "field_44444444_4444_4444_8444_444444444444";
const field: Field = {
  id: fieldId,
  tableId,
  name: "Revenue",
  columnName: "revenue",
  type: "number",
};
const table = {
  id: tableId,
  name: "Orders",
  fields: [field],
} as DataTable;
const compiledInsight = {
  id: insightId,
  name: "Revenue by segment",
  dimensions: [field],
  metrics: [],
  filters: [],
  sorts: [],
} as CompiledInsight;
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
const visualization = {
  id: visualizationId,
  name: "Revenue chart",
  insightId,
  visualizationType: "barY",
  encoding: { y: fieldEncoding(fieldId) },
  createdAt: 0,
} as Visualization;

describe("VisualizationConfigPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("PointerEvent", MouseEvent);
  });

  it("shows display labels instead of SQL expressions for an unsaved chart", () => {
    render(
      <VisualizationConfigPanel
        activeChartType="barY"
        availableChartTypes={new Set(["barY"])}
        activeSuggestionEncoding={{
          x: fieldAlias,
          y: `sum(${fieldAlias})`,
        }}
        visualizations={[]}
        compiledInsight={compiledInsight}
        dataTable={table}
        availableFields={[field]}
        availableColumns={[{ name: fieldAlias, type: "number" }]}
        columnDisplayNames={{ [fieldAlias]: "Revenue" }}
        columnAnalysis={analysis}
        onSelectChartType={vi.fn()}
        onSelectVisualization={vi.fn()}
        updateVisualization={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Revenue").length).toBeGreaterThan(0);
    expect(screen.getByText("Sum of Revenue")).toBeTruthy();
    expect(screen.queryByText(fieldAlias)).toBeNull();
    expect(screen.queryByText(`sum(${fieldAlias})`)).toBeNull();
  });

  it("writes a saved visualization encoding through the shared hook", async () => {
    const updateVisualization = vi.fn().mockResolvedValue(undefined);
    render(
      <VisualizationConfigPanel
        activeChartType="barY"
        availableChartTypes={new Set(["barY"])}
        activeVisualization={visualization}
        visualizations={[visualization]}
        compiledInsight={compiledInsight}
        dataTable={table}
        availableFields={[field]}
        availableColumns={[{ name: fieldAlias, type: "number" }]}
        columnDisplayNames={{ [fieldAlias]: "Revenue" }}
        columnAnalysis={analysis}
        onSelectChartType={vi.fn()}
        onSelectVisualization={vi.fn()}
        updateVisualization={updateVisualization}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Set X encoding" }));
    await waitFor(() =>
      expect(updateVisualization).toHaveBeenCalledWith({
        id: visualizationId,
        updates: {
          encoding: {
            y: fieldEncoding(fieldId),
            x: fieldEncoding(fieldId),
            xType: "quantitative",
          },
        },
      }),
    );
  });
});
