/**
 * Shared test fixtures for Insight tests
 *
 * Provides reusable factory functions for creating test data:
 * - createField: Creates DataTableField instances
 * - createDataTableInfo: Creates DataTableInfo instances
 * - createInsightConfig: Creates InsightConfiguration instances
 */
import type { DataTableField, DataTableInfo, UUID } from "@dashframe/engine";
import type { InsightConfiguration } from "../insight";

/**
 * Creates a valid DataTableField for testing.
 */
export function createField(
  name: string,
  overrides?: Partial<DataTableField>,
): DataTableField {
  return {
    id: crypto.randomUUID() as UUID,
    name,
    columnName: overrides?.columnName ?? name.toLowerCase().replace(/ /g, "_"),
    type: overrides?.type ?? "string",
    ...overrides,
  };
}

/**
 * Creates a valid DataTableInfo for testing.
 */
export function createDataTableInfo(
  name: string,
  fields: DataTableField[],
  overrides?: Partial<DataTableInfo>,
): DataTableInfo {
  return {
    id: crypto.randomUUID() as UUID,
    name,
    dataFrameId: crypto.randomUUID() as UUID,
    fields,
    ...overrides,
  };
}

/**
 * Creates a minimal valid InsightConfiguration for testing.
 */
export function createInsightConfig(
  overrides?: Partial<InsightConfiguration>,
): InsightConfiguration {
  const fields = [createField("Name"), createField("Age"), createField("City")];
  const baseTable = createDataTableInfo("users", fields);

  return {
    name: "Test Insight",
    baseTable,
    ...overrides,
  };
}
