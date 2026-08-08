import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(
    process.cwd(),
    "src/app/visualizations/[visualizationId]/_components/VisualizationPageContent.tsx",
  ),
  "utf8",
);

describe("VisualizationPageContent delete confirmation contract", () => {
  it("defers removal until the shared dialog's confirm callback", () => {
    const start = source.indexOf("const handleDelete = () =>");
    const end = source.indexOf("const contextPanelContent", start);
    const handler = source.slice(start, end);

    expect(source).toContain("useConfirmDialogStore");
    expect(handler).toContain('title: "Delete visualization"');
    expect(handler).toContain('confirmLabel: "Delete"');
    expect(handler).toContain('variant: "destructive"');
    expect(handler).toMatch(
      /onConfirm: async \(\) => \{[\s\S]*removeVisualizationMutation\(\{ id: visualizationId as UUID \}\)/,
    );
    expect(handler.indexOf("onConfirm")).toBeLessThan(
      handler.indexOf("removeVisualizationMutation"),
    );
  });
});
