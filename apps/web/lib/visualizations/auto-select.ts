import type { VisualizationType, VisualizationEncoding } from "../stores/types";

/**
 * Helper to check if a column looks like an identifier
 */
const isLikelyId = (col: string) => {
  const lower = col.toLowerCase();
  return lower === "id" || lower.endsWith("_id") || lower.endsWith("id");
};

/**
 * Auto-selects axes based on chart type and available columns.
 * Preserves existing valid axes when possible.
 */
export function autoSelectEncoding(
  type: VisualizationType,
  columns: string[],
  numericColumns: string[],
  currentEncoding: VisualizationEncoding = {}
): VisualizationEncoding {
  let newEncoding = { ...currentEncoding };

  if (type === "bar" || type === "line" || type === "area") {
    // For these charts: X is usually categorical/time (non-numeric), Y is numeric
    
    // Preserve X if it's valid (exists in columns)
    let xColumn = newEncoding.x;
    if (!xColumn || !columns.includes(xColumn)) {
      xColumn = columns.find(col => !numericColumns.includes(col)) || columns[0];
    }

    // Preserve Y if it's valid (exists in numericColumns)
    let yColumn = newEncoding.y;
    if (!yColumn || !numericColumns.includes(yColumn)) {
      // Prefer non-ID numeric columns
      yColumn = numericColumns.find(col => !isLikelyId(col)) || numericColumns[0];
    }
    
    newEncoding = {
      ...newEncoding,
      x: xColumn,
      y: yColumn,
    };
  } else if (type === "scatter") {
    // For scatter: X and Y should both be numeric
    
    // Preserve X if it's valid AND numeric
    let xColumn = newEncoding.x;
    if (!xColumn || !numericColumns.includes(xColumn)) {
      xColumn = numericColumns[0];
    }

    // Preserve Y if it's valid AND numeric
    let yColumn = newEncoding.y;
    if (!yColumn || !numericColumns.includes(yColumn)) {
      // Try to find a different numeric column for Y
      yColumn = numericColumns.find(col => col !== xColumn && !isLikelyId(col)) 
        || numericColumns.find(col => col !== xColumn) 
        || numericColumns[0];
    }
    
    newEncoding = {
      ...newEncoding,
      x: xColumn,
      y: yColumn,
    };
  }

  return newEncoding;
}
