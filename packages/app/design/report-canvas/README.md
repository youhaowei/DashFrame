# Report canvas prototypes

Clickable prototypes for how the report editor should handle screen sizes. They
share one fake report, a grid engine, and the workbench shell (report pane,
canvas, item pane, Preview). Nothing persists; reload to reset.

```sh
bunx vp dev --config packages/app/design/report-canvas/preview.config.ts
```

Open `http://127.0.0.1:4384/frame.html`; the bar at the top switches prototypes
and theme.

## The question

The editor's side panes narrow the canvas, and a report laid out narrower draws
different charts. Reports are fluid, so there is no single "real" width to
design at. Should editing look like a Figma canvas where you design for several
screen sizes?

## Prototypes

**1 · Frame** (`frame.html`). One report frame on the canvas with a width picker
(This window, Laptop, Desktop, Wide, Tablet, Phone), a pixel input, a draggable
edge, and zoom (Fit, 50%, 75%, 100%). One layout: desktop widths are arranged by
hand, tablet and phone arrange themselves from it and can't be dragged. "This
window" at Fit is what the branch ships today.

**2 · Artboards** (`artboards.html`). Desktop, tablet, and phone frames side by
side on a pan-and-zoom canvas, all showing the same layout. Drag on desktop and
watch the others reflow. Scroll or drag the background to pan, ⌘/Ctrl + scroll
to zoom, click a frame name to focus it, drag a frame edge to change its width.

**3 · Per-size layouts** (`per-size.html`). The same canvas, but dragging on
tablet or phone forks that size into its own layout. The frame label and the
item pane show which sizes follow desktop, with Reset to rejoin. Add an item
after forking to see where it lands on a custom size (the bottom).

## What to try

- Drag the frame edge in 1 across 996px and 600px and watch the bar chart's
  labels go from full, to clipped, to angled.
- In 2, arrange desktop and check whether tablet's automatic arrangement is
  good enough, or whether you want 3.
- In 3, customise phone, then add and remove items on desktop. That upkeep is
  the cost of per-size layouts.

## Prototype-only choices

- Breakpoints are Desktop ≥ 996px (12 columns), Tablet ≥ 600px (6 columns),
  Phone (stacked). The app today has one 12-column layout down to 480px.
- Charts are SVG drawn from theme tokens, not the app's chart renderer.
