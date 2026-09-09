# Report layout directions

Three static mocks of the report detail page. Serve them with the preview command
below and open `canvas.html`, `inspector.html`, or `document.html`. The shared app
stylesheet supplies the theme tokens; the theme toggle affects only the preview and
every control is inert.

```sh
bunx vp dev --config packages/app/design/report-layout/preview.config.ts
```

Open `http://127.0.0.1:4383/canvas.html`.

## The problem these answer

`DashboardDetailContent.tsx` renders a `shrink-0` block capped at `max-h-[42vh]`
holding a **Questions (n)** card grid and a **Saved views (n)** card grid, and only
below that the `DashboardGrid` that is the report. `resolveReportContents` derives
those saved views by iterating `report.items` where `type === "visualization"`, so
the catalog is by construction the set of chart widgets rendered underneath it — it
can never show anything the grid does not already show. A report with one chart
spends ~340px of an 828px viewport restating that chart before drawing it; at three
or four views the block reaches its cap and the report is permanently confined below
it with its own scrollbar.

Two related symptoms come from the same cause. An empty report presents three empty
inventories (`Questions (0)`, `Saved views (0)`, blank grid). And authoring leaves
the page: `/insights/<id>?reportId=<id>` carries the report id, but `InsightView`
reads it only to aim the "Add to report" button, so the breadcrumb reads
`Questions › <name>` and the report is never named.

## Directions

**A · Canvas** (`canvas.html`) — delete the catalog. The grid starts at the top of
the page and provenance moves onto each widget (`from q3-revenue`), where it is one
click from the chart it describes instead of a duplicate card. Adding is a tile in
the grid and a header action, not a mode behind "Edit report". The empty state is a
single invitation. Cheapest to build; loses the "what questions feed this report"
overview entirely.

**B · Inspector** (`inspector.html`) — fold the catalog into a contextual inspector.
The grid is still the report; selecting a widget opens a right panel with that
view's question, encoding, and an edit-in-place action, which is what DESIGN.md asks
for when it says editing should preserve spatial continuity. A second **Contents**
tab keeps the old catalog available on demand for the one job it served. More work
than A, and the inspector costs 268px of width whenever it is open.

**C · Document** (`document.html`) — the report is a narrative read top to bottom:
section headings, prose, charts inline as evidence, each captioned with its source.
The catalog becomes a left outline that scrolls the document rather than navigating
away. This is the largest departure — it makes the report a thing you publish rather
than a board you arrange, and it implies markdown items become first-class structure
rather than another widget type.

## Not yet decided

The direction is the director's call. A and B share a grid model and can be
sequenced (A first, B later); C is a different product thesis and should not be
started as a refinement of the other two.
