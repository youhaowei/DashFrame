import type { TopLevelSpec } from "vega-lite";
import type { DataFrameRow, DataFrameColumn } from "@dashframe/core";
import type { Visualization } from "@/lib/stores/types";

// StandardType is not exported from vega-lite's main module
type StandardType = "quantitative" | "ordinal" | "temporal" | "nominal";

// Simple data format with rows and columns
type DataFrameInput = { rows: DataFrameRow[]; columns: DataFrameColumn[] };

// Helper to get CSS variable color value
export function getCSSColor(variable: string): string {
  if (typeof window === "undefined") return "#000000";
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(variable)
    .trim();
  return value || "#000000";
}

// Get theme-aware Vega-Lite config
export function getVegaThemeConfig() {
  return {
    background: getCSSColor("--color-card"),
    view: {
      stroke: getCSSColor("--color-border"),
      strokeWidth: 1,
    },
    axis: {
      domainColor: getCSSColor("--color-border"),
      gridColor: getCSSColor("--color-border"),
      tickColor: getCSSColor("--color-border"),
      labelColor: getCSSColor("--color-foreground"),
      titleColor: getCSSColor("--color-foreground"),
      labelFont: "inherit",
      titleFont: "inherit",
    },
    legend: {
      labelColor: getCSSColor("--color-foreground"),
      titleColor: getCSSColor("--color-foreground"),
      labelFont: "inherit",
      titleFont: "inherit",
    },
    title: {
      color: getCSSColor("--color-foreground"),
      font: "inherit",
    },
  };
}

export function buildVegaSpec(
  viz: Visualization,
  dataFrame: DataFrameInput,
): TopLevelSpec {
  const { visualizationType, encoding } = viz;
  const { rows, columns } = dataFrame;

  // Common spec properties
  const commonSpec = {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json" as const,
    data: { values: rows },
    width: "container" as const,
    height: "container" as const,
    autosize: { type: "fit" as const, contains: "padding" as const },
    config: getVegaThemeConfig(),
  };

  // If no encoding is set, use defaults
  const x = encoding?.x || columns?.[0]?.name || "x";
  const y =
    encoding?.y ||
    columns?.find((col) => col.type === "number")?.name ||
    columns?.[1]?.name ||
    "y";

  switch (visualizationType) {
    case "bar":
      return {
        ...commonSpec,
        mark: { type: "bar" as const, stroke: null },
        encoding: {
          x: { field: x, type: (encoding?.xType || "nominal") as StandardType },
          y: {
            field: y,
            type: (encoding?.yType || "quantitative") as StandardType,
          },
          ...(encoding?.color && {
            color: { field: encoding.color, type: "nominal" as const },
          }),
        },
      };

    case "line":
      return {
        ...commonSpec,
        mark: "line" as const,
        encoding: {
          x: { field: x, type: (encoding?.xType || "ordinal") as StandardType },
          y: {
            field: y,
            type: (encoding?.yType || "quantitative") as StandardType,
          },
          ...(encoding?.color && {
            color: { field: encoding.color, type: "nominal" as const },
          }),
        },
      };

    case "scatter":
      return {
        ...commonSpec,
        mark: "point" as const,
        encoding: {
          x: {
            field: x,
            type: (encoding?.xType || "quantitative") as StandardType,
          },
          y: {
            field: y,
            type: (encoding?.yType || "quantitative") as StandardType,
          },
          ...(encoding?.color && {
            color: { field: encoding.color, type: "nominal" as const },
          }),
          ...(encoding?.size && {
            size: { field: encoding.size, type: "quantitative" as const },
          }),
        },
      };

    case "area":
      return {
        ...commonSpec,
        mark: "area" as const,
        encoding: {
          x: { field: x, type: (encoding?.xType || "ordinal") as StandardType },
          y: {
            field: y,
            type: (encoding?.yType || "quantitative") as StandardType,
          },
          ...(encoding?.color && {
            color: { field: encoding.color, type: "nominal" as const },
          }),
        },
      };

    default:
      // Fallback to bar chart
      return {
        ...commonSpec,
        mark: { type: "bar" as const, stroke: null },
        encoding: {
          x: { field: x, type: (encoding?.xType || "nominal") as StandardType },
          y: {
            field: y,
            type: (encoding?.yType || "quantitative") as StandardType,
          },
        },
      };
  }
}
