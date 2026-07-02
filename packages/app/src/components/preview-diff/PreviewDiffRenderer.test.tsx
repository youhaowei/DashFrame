/**
 * Tests for PreviewDiffRenderer.
 *
 * Contracts tested:
 * 1. Metadata renders immediately — insight node name, kind badge, and change
 *    badge appear without waiting for compute.
 * 2. Pending indicator: when compute===undefined for an insight node with a
 *    non-noop change, the "Computing row counts…" pending state is shown.
 * 3. Compute display: once compute is present, row counts and head rows render.
 * 4. noop insight nodes: no compute display at all (no pending, no counts).
 * 5. Non-insight nodes: no compute display regardless of compute presence.
 * 6. Downstream blast-radius and partial-failure error sections render.
 * 7. Empty state when no direct nodes and no error.
 */

import type {
  PreviewCompute,
  PreviewDiff,
  PreviewDirectNode,
  PreviewDownstreamNode,
} from "@dashframe/types";
import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { PreviewDiffRenderer } from "./PreviewDiffRenderer";

// ---------------------------------------------------------------------------
// Lightweight @wystack/ui stub — avoids pulling in the full component library.
// ---------------------------------------------------------------------------

vi.mock("@wystack/ui", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function insightNode(
  nodeId: string,
  change: PreviewDirectNode["change"],
  compute?: PreviewCompute,
): PreviewDirectNode {
  return {
    nodeId: nodeId as PreviewDirectNode["nodeId"],
    kind: "insight",
    name: `Insight ${nodeId}`,
    change,
    intent: [],
    before: change === "create" ? null : { baseTableId: "t1" },
    proposedDefinition: { baseTableId: "t1" },
    compute,
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

function downstreamNode(nodeId: string): PreviewDownstreamNode {
  return {
    nodeId: nodeId as PreviewDownstreamNode["nodeId"],
    kind: "dataFrame",
    name: `Frame ${nodeId}`,
    edge: "insight->dataFrame",
    via: { kind: "insight", id: "ins-1" as PreviewDirectNode["nodeId"] },
    flag: "recompute",
  };
}

function makeDiff(
  directNodes: PreviewDirectNode[],
  opts: {
    downstream?: PreviewDownstreamNode[];
    error?: PreviewDiff["error"];
  } = {},
): PreviewDiff {
  return {
    mode: "preview",
    directNodes,
    affectedDownstream: opts.downstream ?? [],
    tablesWritten: [],
    error: opts.error,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PreviewDiffRenderer", () => {
  describe("metadata renders immediately (before compute)", () => {
    it("renders insight node name and badges without compute", () => {
      // compute is undefined — simulates the server-delivered state (pre-fill).
      const diff = makeDiff([insightNode("ins-1", "update", undefined)]);

      render(<PreviewDiffRenderer diff={diff} />);

      // getByText throws if absent — wrap in expect so sonarjs sees an assertion.
      expect(screen.getByText("Insight ins-1")).toBeDefined();
      expect(screen.getByText("Insight")).toBeDefined(); // kind badge
      expect(screen.getByText("Changed")).toBeDefined(); // change badge
    });

    it("renders create node name and badges immediately", () => {
      const diff = makeDiff([insightNode("ins-new", "create", undefined)]);

      render(<PreviewDiffRenderer diff={diff} />);

      expect(screen.getByText("Insight ins-new")).toBeDefined();
      expect(screen.getByText("New")).toBeDefined();
    });

    it("renders non-insight node metadata without any compute display", () => {
      const diff = makeDiff([dataTableNode("dt-1")]);

      render(<PreviewDiffRenderer diff={diff} />);

      expect(screen.getByText("Table dt-1")).toBeDefined();
      expect(screen.getByText("Data Table")).toBeDefined();
      expect(screen.queryByText(/Computing/)).toBeNull();
    });
  });

  describe("pending indicator — compute===undefined for active insight node", () => {
    it("shows pending indicator when compute is undefined on an update node", () => {
      const diff = makeDiff([insightNode("ins-pending", "update", undefined)]);

      render(<PreviewDiffRenderer diff={diff} />);

      // Pending text visible — getByText throws if absent.
      expect(screen.getByText(/Computing row counts/)).toBeDefined();
      // The pulse-dot aria label.
      expect(screen.getByLabelText("Computing...")).toBeDefined();
    });

    it("shows pending indicator when compute is undefined on a create node", () => {
      const diff = makeDiff([insightNode("ins-create", "create", undefined)]);

      render(<PreviewDiffRenderer diff={diff} />);

      expect(screen.getByText(/Computing row counts/)).toBeDefined();
    });

    it("does NOT show pending indicator for a noop insight node", () => {
      const diff = makeDiff([insightNode("ins-noop", "noop", undefined)]);

      render(<PreviewDiffRenderer diff={diff} />);

      expect(screen.queryByText(/Computing/)).toBeNull();
      expect(screen.queryByLabelText("Computing...")).toBeNull();
    });

    it("does NOT show pending indicator for a non-insight node (even with undefined compute)", () => {
      // dataTable nodes have no compute slot at all.
      const diff = makeDiff([dataTableNode("dt-no-compute")]);

      render(<PreviewDiffRenderer diff={diff} />);

      expect(screen.queryByText(/Computing/)).toBeNull();
    });
  });

  describe("compute display — when compute is present", () => {
    it("renders row count delta when compute is filled", () => {
      const compute: PreviewCompute = {
        rowCountBefore: 10,
        rowCountAfter: 15,
        head: [],
      };
      const diff = makeDiff([insightNode("ins-count", "update", compute)]);

      render(<PreviewDiffRenderer diff={diff} />);

      // Should show 15 rows with a +5 delta.
      expect(screen.getByText(/15/)).toBeDefined();
      expect(screen.getByText(/\+5/)).toBeDefined();
    });

    it("renders head rows when compute is filled with head data", () => {
      const compute: PreviewCompute = {
        rowCountBefore: null,
        rowCountAfter: 3,
        head: [
          { name: "Alice", score: 100 },
          { name: "Bob", score: 200 },
        ],
      };
      const diff = makeDiff([insightNode("ins-head", "create", compute)]);

      render(<PreviewDiffRenderer diff={diff} />);

      // Column headers.
      expect(screen.getByText("name")).toBeDefined();
      expect(screen.getByText("score")).toBeDefined();
      // Row values.
      expect(screen.getByText("Alice")).toBeDefined();
      expect(screen.getByText("Bob")).toBeDefined();
      expect(screen.getByText("100")).toBeDefined();
      expect(screen.getByText("200")).toBeDefined();
    });

    it("renders null values as 'null' in head table", () => {
      const compute: PreviewCompute = {
        rowCountBefore: null,
        rowCountAfter: 1,
        head: [{ col: null }],
      };
      const diff = makeDiff([insightNode("ins-null-val", "create", compute)]);

      render(<PreviewDiffRenderer diff={diff} />);

      expect(screen.getByText("null")).toBeDefined();
    });

    it("does NOT show pending indicator when compute is present", () => {
      const compute: PreviewCompute = {
        rowCountBefore: 0,
        rowCountAfter: 5,
        head: [],
      };
      const diff = makeDiff([insightNode("ins-no-pending", "update", compute)]);

      render(<PreviewDiffRenderer diff={diff} />);

      expect(screen.queryByText(/Computing/)).toBeNull();
    });
  });

  // FIX 5 — RESOLVED-but-empty must render an honest "unavailable" state, not an
  // infinite spinner. A resolved compute with rowCountAfter=null AND head=[] is
  // the "couldn't compute" sentinel (missing base table / SQL build failure /
  // un-resolvable proposed source). It must be visually distinct from PENDING.
  describe("FIX 5 — resolved-but-empty renders the unavailable state", () => {
    it("shows the 'Preview unavailable' message, not the pending spinner", () => {
      const compute: PreviewCompute = {
        rowCountBefore: null,
        rowCountAfter: null,
        head: [],
      };
      const diff = makeDiff([insightNode("ins-empty", "update", compute)]);

      render(<PreviewDiffRenderer diff={diff} />);

      // The honest unavailable message is shown.
      expect(screen.getByText(/Preview unavailable/)).toBeDefined();
      // It is NOT the pending spinner (compute is defined, just empty).
      expect(screen.queryByText(/Computing row counts/)).toBeNull();
      expect(screen.queryByLabelText("Computing...")).toBeNull();
    });

    it("does NOT show unavailable state when a real count is present", () => {
      const compute: PreviewCompute = {
        rowCountBefore: 3,
        rowCountAfter: 7,
        head: [],
      };
      const diff = makeDiff([insightNode("ins-ok", "update", compute)]);

      render(<PreviewDiffRenderer diff={diff} />);

      expect(screen.queryByText(/Preview unavailable/)).toBeNull();
      expect(screen.getByText(/7/)).toBeDefined();
    });
  });

  describe("downstream blast radius", () => {
    it("renders downstream section when affectedDownstream is non-empty", () => {
      const diff = makeDiff([insightNode("ins-ds", "update")], {
        downstream: [downstreamNode("df-1")],
      });

      render(<PreviewDiffRenderer diff={diff} />);

      expect(screen.getByText("Also affected")).toBeDefined();
      expect(screen.getByText("Frame df-1")).toBeDefined();
      expect(screen.getByText("Will recompute")).toBeDefined();
    });

    it("does not render downstream section when affectedDownstream is empty", () => {
      const diff = makeDiff([insightNode("ins-nods", "update")]);

      render(<PreviewDiffRenderer diff={diff} />);

      expect(screen.queryByText("Also affected")).toBeNull();
    });
  });

  describe("partial-failure error banner", () => {
    it("renders the error banner with user-facing copy, never the raw message", () => {
      const diff = makeDiff([], {
        error: { commandIndex: 2, message: "Table not found: sales_data" },
      });

      render(<PreviewDiffRenderer diff={diff} />);

      expect(screen.getByRole("alert")).toBeDefined();
      expect(
        screen.getByText(
          "Command 3 in this draft could not be previewed. Review or edit the draft, then try again.",
        ),
      ).toBeDefined();
      expect(screen.queryByText("Table not found: sales_data")).toBeNull();
    });

    it("changes 'Changes' section header to 'Would change' when error present", () => {
      const diff = makeDiff([insightNode("ins-err", "update")], {
        error: { commandIndex: 1, message: "boom" },
      });

      render(<PreviewDiffRenderer diff={diff} />);

      expect(screen.getByText("Would change")).toBeDefined();
      expect(screen.queryByText("Changes")).toBeNull();
    });
  });

  describe("empty state", () => {
    it("renders empty state when there are no direct nodes and no error", () => {
      const diff = makeDiff([]);

      render(<PreviewDiffRenderer diff={diff} />);

      expect(screen.getByText("No changes in this batch.")).toBeDefined();
    });
  });
});
