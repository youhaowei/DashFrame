import type { DataTable, Field, Insight, UUID } from "@dashframe/types";
import { describe, expect, it } from "vitest";

import { buildJoinPreviewInsight } from "./JoinConfigureContent";

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
  baseTableId,
  selectedFields: [leftField.id],
  metrics: [],
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
      baseTableId,
      selectedFields: [],
      metrics: [],
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
});
