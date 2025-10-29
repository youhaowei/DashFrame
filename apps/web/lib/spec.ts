import type { DataFrame } from "@dash-frame/dataframe";
import type { TopLevelSpec } from "vega-lite";

export type AxisSelection = {
  x: string | null;
  y: string | null;
};

const toVegaType = (
  type: DataFrame["columns"][number]["type"],
): "quantitative" | "temporal" | "nominal" => {
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

export const buildVegaLiteSpec = (
  dataFrame: DataFrame,
  selections: AxisSelection,
): TopLevelSpec | null => {
  const { x: xColumnName, y: yColumnName } = selections;
  const xColumn = dataFrame.columns.find(
    (column) => column.name === xColumnName,
  );
  const yColumn = dataFrame.columns.find(
    (column) => column.name === yColumnName,
  );

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
      tooltip: dataFrame.columns.map((column) => ({
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
