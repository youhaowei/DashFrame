import type { DataTable, Field, Insight, UUID } from "@dashframe/types";
import { describe, expect, it } from "vitest";

import {
  buildJoinPreviewInsight,
  isJoinPreviewComputing,
} from "./JoinConfigureContent";

const baseTableId = "10000000-0000-4000-8000-000000000001" as UUID;
const joinTableId = "10000000-0000-4000-8000-000000000002" as UUID;
const leftField = {
  id: "10000000-0000-4000-8000-000000000003",
  tableId: baseTableId,
  name: "Account ID",
  columnName: "account_id",
  type: "string",
} as Field;
const rightField = {
  id: "10000000-0000-4000-8000-000000000004",
  tableId: joinTableId,
  name: "ID",
  columnName: "id",
  type: "string",
} as Field;
const insight = {
  id: "10000000-0000-4000-8000-000000000005",
  name: "Accounts",
  source: { sourceType: "dataTable", sourceId: baseTableId },
  selectedFields: [leftField.id],
  metrics: [],
  filters: [
    {
      field: leftField.id,
      operator: "eq",
      value: "active",
    },
  ],
  sorts: [{ field: leftField.id, direction: "asc" }],
  joins: [],
  createdAt: 0,
} as Insight;
const joinTable = {
  id: joinTableId,
  name: "Owners",
  fields: [rightField],
} as DataTable;

describe("join preview definition", () => {
  it("uses a typed ephemeral Insight and maps outer to the persisted full join", () => {
    const preview = buildJoinPreviewInsight(
      insight,
      joinTable,
      leftField,
      rightField,
      "outer",
    );

    expect(preview).toMatchObject({
      source: { sourceType: "dataTable", sourceId: baseTableId },
      selectedFields: [],
      metrics: [],
      filters: [],
      sorts: [],
      joins: [
        {
          type: "full",
          rightTableId: joinTableId,
          leftKey: "account_id",
          rightKey: "id",
        },
      ],
    });
    expect(preview).not.toHaveProperty("sql");
    expect(preview).not.toHaveProperty("providerId");
    expect(preview).not.toHaveProperty("placement");
  });

  it("stops computing when the structured preview result fails", () => {
    expect(isJoinPreviewComputing(insight, false, null)).toBe(true);
    expect(isJoinPreviewComputing(insight, false, "Connector offline")).toBe(
      false,
    );
  });
});
