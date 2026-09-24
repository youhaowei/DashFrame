/**
 * Tests for the change-detail rows the drafts review surface shows for a
 * preview-diff direct node.
 */

import type { PreviewDirectNode } from "@dashframe/types";
import { describe, expect, it } from "vite-plus/test";
import { formatValue, getChangeDetails } from "./change-details";

function insightNode(
  nodeId: string,
  change: PreviewDirectNode["change"],
): PreviewDirectNode {
  return {
    nodeId: nodeId as PreviewDirectNode["nodeId"],
    kind: "insight",
    name: `Insight ${nodeId}`,
    change,
    intent: [],
    before: change === "create" ? null : { baseTableId: "t1" },
    proposedDefinition: { baseTableId: "t1" },
  };
}

function dataTableNode(nodeId: string): PreviewDirectNode {
  return {
    nodeId: nodeId as PreviewDirectNode["nodeId"],
    kind: "dataTable",
    name: `Table ${nodeId}`,
    change: "update",
    intent: [],
    before: { name: "old" },
    proposedDefinition: { name: "new" },
  };
}

/** The rows as the drafts surface prints them: `key: before → after`. */
function detailRows(node: PreviewDirectNode): string[] {
  return getChangeDetails(node).map(
    ({ key, before, after }) =>
      `${key}: ${formatValue(before)} → ${formatValue(after)}`,
  );
}

describe("getChangeDetails", () => {
  it("describes the actual field change from the node's before slice", () => {
    const node: PreviewDirectNode = {
      ...dataTableNode("dt-field"),
      before: {
        fields: [
          {
            id: "3c4708a7-a85d-457e-b69d-3226b0a1cfd5",
            name: "revenue",
          },
        ],
      },
      proposedDefinition: {
        nodeId: "dt-field",
        fieldId: "3c4708a7-a85d-457e-b69d-3226b0a1cfd5",
        updates: { name: "Revenue (USD)" },
      },
    };

    const rows = detailRows(node);

    expect(rows).toContain("name: revenue → Revenue (USD)");
  });

  it("describes a merged nested update once without fabricating target changes", () => {
    const node: PreviewDirectNode = {
      ...dataTableNode("dt-merged-nested-update"),
      before: {
        fields: [
          {
            id: "3c4708a7-a85d-457e-b69d-3226b0a1cfd5",
            name: "revenue",
          },
        ],
        metrics: [
          {
            id: "fdd13f3e-b880-4524-a829-6515aeb7ccc7",
            name: "Revenue",
          },
        ],
      },
      proposedDefinition: {
        nodeId: "dt-merged-nested-update",
        fieldId: "3c4708a7-a85d-457e-b69d-3226b0a1cfd5",
        metricId: "fdd13f3e-b880-4524-a829-6515aeb7ccc7",
        updates: { name: "Total revenue", format: "currency" },
      },
    };

    const rows = detailRows(node);

    expect(rows).toContain(
      "one of: field revenue, metric Revenue — name: — → Total revenue",
    );
    expect(rows).toContain(
      "one of: field revenue, metric Revenue — format: — → currency",
    );
    expect(rows).not.toContain("name: revenue → Total revenue");
    expect(rows).not.toContain("name: Revenue → Total revenue");
  });

  it("describes a resolved join update from its positional index", () => {
    const node: PreviewDirectNode = {
      ...insightNode("join-update", "update"),
      before: { joins: [{ name: "Orders users", type: "inner" }] },
      proposedDefinition: { joinIndex: 0, updates: { type: "left" } },
    };

    const rows = detailRows(node);

    expect(rows).toContain("type: inner → left");
  });

  it("keeps unresolvable merged targets in the ambiguous label", () => {
    const fieldId = "3c4708a7-a85d-457e-b69d-3226b0a1cfd5";
    const node: PreviewDirectNode = {
      ...dataTableNode("partially-resolved-merged-update"),
      before: { fields: [{ id: fieldId }] },
      proposedDefinition: {
        nodeId: "partially-resolved-merged-update",
        fieldId,
        joinIndex: 0,
        updates: { name: "Renamed field" },
      },
    };

    const rows = detailRows(node);

    expect(rows).toContain(
      "one of: field 3c4708a7…, join #0 — name: — → Renamed field",
    );
    expect(rows).not.toContain("name: — → Renamed field");
  });

  it("does not describe a fallback row for a resolved no-op nested update", () => {
    const node: PreviewDirectNode = {
      ...dataTableNode("unchanged-field"),
      before: { fields: [{ id: "f1", name: "revenue" }] },
      proposedDefinition: {
        nodeId: "unchanged-field",
        fieldId: "f1",
        updates: { name: "revenue" },
      },
    };

    const rows = detailRows(node);

    expect(rows.some((row) => /name:/.test(row))).toBe(false);
  });

  it("expands dashboard item updates into per-key detail rows", () => {
    const node: PreviewDirectNode = {
      ...dataTableNode("dashboard-item"),
      before: {
        layout: [
          {
            id: "item-1",
            type: "markdown",
            x: 1,
            y: 2,
            width: 3,
            height: 2,
          },
        ],
      },
      proposedDefinition: {
        nodeId: "dashboard-item",
        itemId: "item-1",
        updates: { width: 4, height: 2 },
      },
    };

    const rows = detailRows(node);

    expect(rows).toContain("width: 3 → 4");
    expect(rows).not.toContain("height: 2 → 2");
    expect(rows.some((row) => /updates:/.test(row))).toBe(false);
  });

  it("redacts secret references in detail rows", () => {
    const oldSecretRef = "secret:3c4708a7-a85d-457e-b69d-3226b0a1cfd5";
    const newSecretRef = "secret:fdd13f3e-b880-4524-a829-6515aeb7ccc7";
    const node: PreviewDirectNode = {
      ...dataTableNode("secret-config"),
      before: { apiKey: oldSecretRef },
      proposedDefinition: { apiKey: newSecretRef },
    };

    const rows = detailRows(node);

    expect(rows).toContain("apiKey: •••••• → ••••••");
    expect(rows.join("\n")).not.toContain(oldSecretRef);
    expect(rows.join("\n")).not.toContain(newSecretRef);
  });

  it("expands an unresolvable field update into per-key detail rows", () => {
    const node: PreviewDirectNode = {
      ...dataTableNode("missing-field"),
      before: { fields: [] },
      proposedDefinition: {
        nodeId: "missing-field",
        fieldId: "missing-field-id",
        updates: { name: "Renamed field" },
      },
    };

    const rows = detailRows(node);

    expect(rows).toContain("name: — → Renamed field");
    expect(rows.some((row) => /updates:/.test(row))).toBe(false);
  });

  it("compares source objects using their stored source shape", () => {
    const node: PreviewDirectNode = {
      ...insightNode("source", "update"),
      before: {
        definition: {
          source: { sourceType: "dataTable", sourceId: "table-1" },
          baseTableId: "table-1",
        },
      },
      proposedDefinition: {
        source: { sourceType: "dataTable", sourceId: "table-1" },
      },
    };

    const rows = detailRows(node);

    expect(rows.some((row) => /source:/.test(row))).toBe(false);
  });

  it("normalizes chart operands to their stored visualization shape", () => {
    const node: PreviewDirectNode = {
      ...dataTableNode("chart-type"),
      before: { chartType: "barY", options: { spec: { mark: "bar" } } },
      proposedDefinition: {
        visualizationType: "line",
        spec: { mark: "line" },
      },
    };

    const rows = detailRows(node);

    expect(rows).toContain("chartType: barY → line");
    expect(rows).toContain('spec: {"mark":"bar"} → {"mark":"line"}');
  });

  it("describes changed source objects without comparing them to baseTableId", () => {
    const node: PreviewDirectNode = {
      ...insightNode("changed-source", "update"),
      before: {
        definition: {
          source: { sourceType: "dataTable", sourceId: "table-1" },
          baseTableId: "table-1",
        },
      },
      proposedDefinition: {
        source: { sourceType: "dataTable", sourceId: "table-2" },
      },
    };

    const rows = detailRows(node);

    expect(rows).toContain(
      'source: {"sourceType":"dataTable","sourceId":"table-1"} → {"sourceType":"dataTable","sourceId":"table-2"}',
    );
  });

  it("does not describe a change for objects with reordered keys", () => {
    const node: PreviewDirectNode = {
      ...insightNode("same-filter", "update"),
      before: {
        definition: { filters: [{ field: "region", op: "eq" }] },
      },
      proposedDefinition: {
        filters: [{ op: "eq", field: "region" }],
      },
    };

    const rows = detailRows(node);

    expect(rows.some((row) => /filters:/.test(row))).toBe(false);
  });

  it("does not describe detail rows for a create node", () => {
    const node: PreviewDirectNode = {
      ...insightNode("new-insight", "create"),
      proposedDefinition: {
        baseTableId: "table-1",
        selectedFields: ["field-1"],
      },
    };

    const rows = detailRows(node);

    expect(rows.some((row) => /baseTableId:/.test(row))).toBe(false);
    expect(rows.some((row) => /selectedFields:/.test(row))).toBe(false);
  });
});
