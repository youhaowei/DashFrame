# Design QA: MCP inline report

## Evidence

- Source visual: `docs/qa/mcp-inline-app/source.png`
- Browser-rendered implementation: `docs/qa/mcp-inline-app/light.png`
- Dark-mode implementation: `docs/qa/mcp-inline-app/dark.png`
- Comparison artifact: `docs/qa/mcp-inline-app/comparison.png`
- Reference host viewport: 1280 by 1190 CSS pixels; captured through the
  official MCP Apps v1.7.0 reference host.

## Comparison history

1. The first implementation carried three KPI cards, report metadata, and a
   permanent footer. It was rejected as distracting.
2. The selected direction removed healthy-state metadata, duplicate section
   labels, row and column cards, and one-page pagination.
3. The final browser comparison confirmed the selected hierarchy: one report
   title followed by one full-width card, with four readable columns, aligned
   numeric values, and eight bounded rows.
4. Light and dark captures were checked at the same host viewport. The dark
   surface preserves the same hierarchy and table contrast without animation.

## Findings

- P0: none.
- P1: none.
- P2: none.
- Intentional host difference: the standards reference host supplies its own
  sandbox boundary and theme control outside the app iframe; those controls are
  excluded from the report surface.

Final result: passed.
