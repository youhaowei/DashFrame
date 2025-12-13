import type { DataFrameData, DataFrameColumn } from "@dashframe/core";
import type { TopLevelSpec } from "vega-lite";

export type AxisSelection = {
  x: string | null;
  y: string | null;
};

const toVegaType = (type: string): "quantitative" | "temporal" | "nominal" => {
  switch (type) {
    case "number":
      return "quantitative";
    case "date":
      return "temporal";
    case "boolean":
    case "string":
    case "unknown":
    default:
      return "nominal";
  }
};

/**
 * Build a Vega-Lite spec from a DataFrameData (plain object with rows).
 * Used for chart previews and visualizations.
 */
export const buildVegaLiteSpec = (
  dataFrame: DataFrameData,
  selections: AxisSelection,
): TopLevelSpec | null => {
  const { x: xColumnName, y: yColumnName } = selections;
  const columns: DataFrameColumn[] = dataFrame.columns || [];
  const xColumn = columns.find((column) => column.name === xColumnName);
  const yColumn = columns.find((column) => column.name === yColumnName);

  if (!xColumn || !yColumn || !dataFrame.rows.length) {
    return null;
  }

  const xType = toVegaType(xColumn.type);
  const yType = toVegaType(yColumn.type);
  const mark = yType === "quantitative" && xType !== "nominal" ? "line" : "bar";

  return {
    description: "CSV preview",
    width: "container",
    height: "container",
    autosize: { type: "fit", contains: "padding", resize: true },
    data: { name: "table" },
    mark,
    encoding: {
      x: {
        field: xColumn.name,
        type: xType,
      },
      y: {
        field: yColumn.name,
        type: yType,
      },
      tooltip: columns.map((column) => ({
        field: column.name,
        type: toVegaType(column.type),
      })),
    },
    config: {
      background: "transparent",
      view: { stroke: "transparent" },
      axis: {
        labelColor: "#cbd5f5",
        titleColor: "#cbd5f5",
        domainColor: "#475569",
        tickColor: "#475569",
        gridColor: "#1e293b",
      },
      legend: {
        labelColor: "#cbd5f5",
        titleColor: "#cbd5f5",
      },
    },
  } satisfies TopLevelSpec;
};
