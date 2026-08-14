/**
 * Unit tests for the insights row ↔ domain codec.
 *
 * Pins valid-path byte-identity with the old hand-rolled mappers, the
 * minimal/auto-draft case (schema must tolerate absent arrays), and fail-closed
 * behavior on malformed definition blobs.
 */
import type { Insight } from "@dashframe/types";
import { describe, expect, it } from "vitest";

import {
  decodeInsight,
  decodeStoredInsightDefinition,
  encodeInsightDefinition,
  type InsightRow,
} from "./insights";

const INSIGHT_ID = "insight-1111-2222-3333-444444444444";
const BASE_TABLE_ID = "table-aaaa-bbbb-cccc-dddddddddddd";
const FIELD_ID = "field-1111-2222-3333-444444444444";
const METRIC_ID = "metric-1111-2222-3333-444444444444";

const CREATED_AT = new Date("2024-01-15T12:00:00.000Z");
const UPDATED_AT = new Date("2024-02-20T18:30:00.000Z");

/** Test fixture — allows null timestamps (draft-overlay runtime) and loose definition. */
function makeRow(
  overrides: {
    id?: string;
    name?: string;
    definition?: unknown;
    createdAt?: Date | null;
    updatedAt?: Date | null;
    createdBy?: InsightRow["createdBy"];
  } = {},
): InsightRow {
  return {
    id: overrides.id ?? INSIGHT_ID,
    name: overrides.name ?? "Test Insight",
    definition: overrides.definition ?? {
      source: { sourceType: "dataTable", sourceId: BASE_TABLE_ID },
    },
    createdAt:
      overrides.createdAt === undefined ? CREATED_AT : overrides.createdAt,
    updatedAt:
      overrides.updatedAt === undefined ? UPDATED_AT : overrides.updatedAt,
    createdBy: overrides.createdBy ?? { kind: "user" },
    parentArtifactId: null,
    schema: null,
  } as InsightRow;
}

describe("decodeInsight", () => {
  it("returns the exact domain Insight for a fully-populated row", () => {
    const row = makeRow({
      definition: {
        source: { sourceType: "dataTable", sourceId: BASE_TABLE_ID },
        selectedFields: [FIELD_ID],
        metrics: [
          {
            id: METRIC_ID,
            name: "Total Sales",
            sourceTable: BASE_TABLE_ID,
            columnName: "amount",
            aggregation: "sum",
          },
        ],
        filters: [
          {
            id: "filter-1",
            field: "status",
            operator: "eq",
            value: "open",
          },
        ],
        sorts: [{ field: "amount", direction: "desc" }],
        joins: [
          {
            type: "left",
            rightTableId: "table-right",
            leftKey: "id",
            rightKey: "order_id",
          },
        ],
      },
    });

    const expected: Insight = {
      id: INSIGHT_ID,
      name: "Test Insight",
      source: { sourceType: "dataTable", sourceId: BASE_TABLE_ID },
      selectedFields: [FIELD_ID],
      metrics: [
        {
          id: METRIC_ID,
          name: "Total Sales",
          sourceTable: BASE_TABLE_ID,
          columnName: "amount",
          aggregation: "sum",
        },
      ],
      filters: [
        {
          id: "filter-1",
          field: "status",
          operator: "eq",
          value: "open",
        },
      ],
      sorts: [{ field: "amount", direction: "desc" }],
      joins: [
        {
          type: "left",
          rightTableId: "table-right",
          leftKey: "id",
          rightKey: "order_id",
        },
      ],
      createdAt: CREATED_AT.getTime(),
      updatedAt: UPDATED_AT.getTime(),
    };

    expect(decodeInsight(row)).toEqual(expected);
  });

  it("normalizes a legacy base-only definition to a DataTable source", () => {
    const row = makeRow({
      definition: { baseTableId: BASE_TABLE_ID },
      updatedAt: null,
    });

    const result = decodeInsight(row);

    expect(result.source).toEqual({
      sourceType: "dataTable",
      sourceId: BASE_TABLE_ID,
    });
    expect(result.selectedFields).toEqual([]);
    expect(result.metrics).toEqual([]);
    expect(result.filters).toBeUndefined();
    expect(result.sorts).toBeUndefined();
    expect(result.joins).toBeUndefined();
    expect(result.createdAt).toBe(CREATED_AT.getTime());
    expect(result.updatedAt).toBeUndefined();
  });

  it("round-trips the encoder's minimal output without throwing", () => {
    const source = {
      sourceType: "dataTable" as const,
      sourceId: BASE_TABLE_ID,
    };
    const definition = encodeInsightDefinition({ source });
    const row = makeRow({ definition });

    const result = decodeInsight(row);

    expect(result.selectedFields).toEqual([]);
    expect(result.metrics).toEqual([]);
    expect(result.source).toEqual(source);
    expect(definition).not.toHaveProperty("baseTableId");
  });

  it("throws with the insight id when both source identities are missing", () => {
    const row = makeRow({
      definition: { selectedFields: [], metrics: [] },
    });

    expect(() => decodeInsight(row)).toThrow(
      new RegExp(`Insight ${INSIGHT_ID} has an invalid definition`),
    );
  });

  it("throws with the insight id when metrics is not an array", () => {
    const row = makeRow({
      definition: {
        source: { sourceType: "dataTable", sourceId: BASE_TABLE_ID },
        metrics: "not-an-array",
      },
    });

    expect(() => decodeInsight(row)).toThrow(
      new RegExp(`Insight ${INSIGHT_ID} has an invalid definition`),
    );
  });

  it("tolerates explicit null array fields (JSONB null, not corruption)", () => {
    // A stored blob can carry `null` for an omitted array key. The old read
    // path coalesced these to `[]`/undefined; decode must not reject them.
    const row = makeRow({
      definition: {
        source: { sourceType: "dataTable", sourceId: BASE_TABLE_ID },
        selectedFields: null,
        metrics: null,
        filters: null,
        sorts: null,
        joins: null,
      },
    });

    const result = decodeInsight(row);

    expect(result.selectedFields).toEqual([]);
    expect(result.metrics).toEqual([]);
    expect(result.filters).toBeUndefined();
    expect(result.sorts).toBeUndefined();
    expect(result.joins).toBeUndefined();
  });

  it("passes through element shapes without validating them", () => {
    // Structural validation only: a metric with an unknown aggregation is not
    // corruption at this layer (the write boundary stores metrics as opaque
    // `unknown[]`), so it flows through rather than throwing.
    const row = makeRow({
      definition: {
        source: { sourceType: "dataTable", sourceId: BASE_TABLE_ID },
        metrics: [
          {
            id: METRIC_ID,
            name: "Passthrough",
            sourceTable: BASE_TABLE_ID,
            aggregation: "median",
          },
        ],
      },
    });

    expect(() => decodeInsight(row)).not.toThrow();
    expect(decodeInsight(row).metrics).toEqual([
      {
        id: METRIC_ID,
        name: "Passthrough",
        sourceTable: BASE_TABLE_ID,
        aggregation: "median",
      },
    ]);
  });

  it("coalesces null createdAt to epoch 0 via tsToMillis", () => {
    const row = makeRow({
      createdAt: null,
      definition: {
        source: { sourceType: "dataTable", sourceId: BASE_TABLE_ID },
      },
    });

    expect(decodeInsight(row).createdAt).toBe(0);
  });
});

describe("decodeStoredInsightDefinition", () => {
  it("round-trips every stored key", () => {
    const definition = {
      source: { sourceType: "insight" as const, sourceId: INSIGHT_ID },
      selectedFields: [FIELD_ID],
      metrics: [{ id: METRIC_ID }],
      filters: [{ id: "filter-1" }],
      sorts: [{ field: FIELD_ID }],
      joins: [{ rightTableId: "table-right" }],
    };

    expect(decodeStoredInsightDefinition(makeRow({ definition }))).toEqual(
      definition,
    );
  });

  it("returns source from both stored and domain decoders", () => {
    const source = { sourceType: "insight" as const, sourceId: INSIGHT_ID };
    const row = makeRow({
      definition: { source },
    });

    expect(decodeStoredInsightDefinition(row).source).toEqual(source);
    expect(decodeInsight(row).source).toEqual(source);
  });

  it("rejects conflicting canonical and legacy source ids", () => {
    const row = makeRow({
      definition: {
        baseTableId: BASE_TABLE_ID,
        source: { sourceType: "insight", sourceId: INSIGHT_ID },
      },
    });

    expect(() => decodeStoredInsightDefinition(row)).toThrow(
      /source\.sourceId must match legacy baseTableId/,
    );
  });

  it("throws with the insight id for a malformed source discriminant", () => {
    const row = makeRow({
      definition: {
        source: { sourceType: "dashboard", sourceId: INSIGHT_ID },
      },
    });

    expect(() => decodeStoredInsightDefinition(row)).toThrow(
      new RegExp(`Insight ${INSIGHT_ID} has an invalid definition`),
    );
  });
});

describe("encodeInsightDefinition", () => {
  it("round-trips mapped fields and defaults selectedFields/metrics to []", () => {
    const source = {
      sourceType: "dataTable" as const,
      sourceId: BASE_TABLE_ID,
    };
    expect(encodeInsightDefinition({ source })).toEqual({
      source,
      selectedFields: [],
      metrics: [],
      filters: undefined,
      sorts: undefined,
      joins: undefined,
    });

    const filters = [{ field: "x", operator: "eq" as const, value: 1 }];
    const sorts = [{ field: "x", direction: "asc" as const }];
    const joins = [
      {
        type: "inner" as const,
        rightTableId: "t2",
        leftKey: "a",
        rightKey: "b",
      },
    ];
    const metrics = [
      {
        id: METRIC_ID,
        name: "Count",
        sourceTable: BASE_TABLE_ID,
        aggregation: "count" as const,
      },
    ];

    expect(
      encodeInsightDefinition({
        source,
        selectedFields: [FIELD_ID],
        metrics,
        filters,
        sorts,
        joins,
      }),
    ).toEqual({
      source,
      selectedFields: [FIELD_ID],
      metrics,
      filters,
      sorts,
      joins,
    });
  });

  it("carries source into the stored definition", () => {
    const source = { sourceType: "insight" as const, sourceId: INSIGHT_ID };

    expect(encodeInsightDefinition({ source })).toHaveProperty(
      "source",
      source,
    );
  });

  it("persists and decodes declared runtime controls", () => {
    const runtimeControls = {
      filters: [
        {
          key: "region",
          filterId: "filter-1",
          label: "Region",
          required: true,
        },
      ],
      sort: { allowedFieldIds: [FIELD_ID], maxKeys: 1 },
      limit: { min: 1, max: 100 },
    };
    const definition = encodeInsightDefinition({
      source: { sourceType: "dataTable", sourceId: BASE_TABLE_ID },
      runtimeControls,
    });

    expect(definition.runtimeControls).toEqual(runtimeControls);
    expect(decodeInsight(makeRow({ definition })).runtimeControls).toEqual(
      runtimeControls,
    );
  });

  it("rejects runtime controls with duplicate target filter ids", () => {
    const row = makeRow({
      definition: {
        source: { sourceType: "dataTable", sourceId: BASE_TABLE_ID },
        runtimeControls: {
          filters: [
            { key: "one", filterId: "filter-1", label: "One" },
            { key: "two", filterId: "filter-1", label: "Two" },
          ],
        },
      },
    });
    expect(() => decodeInsight(row)).toThrow(/invalid definition/);
  });
});
