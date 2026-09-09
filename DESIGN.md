# DashFrame design

## Direction

Keep the app calm, functional, and dense enough for analysis. Use floating panels on a tinted canvas, subtle shadows, and window chrome integrated with the sidebar. Customize `@wystack/ui-core` defaults only by exception.

Avoid toolbar-heavy BI chrome, generic dashboards, document-like softness, and a dark-mode-first aesthetic. These anti-references remain provisional. Support light and dark themes; follow the system by default. Brand colour is undecided; use the shared neutral primary.

Use [GLOSSARY.md](GLOSSARY.md) for product vocabulary and model caveats.

## Shared components and surfaces

Tokens and utilities come from `@wystack/ui-core`; components from `@wystack/ui-react`; icons from `@wystack/ui-react/icons`. Both packages are vendored in `libs/stdui`. Local extensions belong in `packages/ui` (`@dashframe/ui`). Change shared primitives and tokens upstream, not through local restyling; generalize after three uses.

| Surface               | Recipe                                                                               |
| --------------------- | ------------------------------------------------------------------------------------ |
| Shell backdrop        | `bg-surface-base`                                                                    |
| Panel shape           | `rounded-[var(--surface-radius)]`; gaps and outer margins use `var(--surface-inset)` |
| Panel fill and shadow | `bg-neutral-bg/90 saturate-[1.2] shadow-[var(--surface-shadow)]`; no border          |

Nav, artifact, and assistant each occupy one panel. Panels own height; page content uses `h-full`, never `h-screen` or `min-h-screen`. Use tokens for colours, radii, and shadows, with no raw colour values in styles or class names. Keep the neutral scale chroma-free; tint belongs to the surface system.

Web and Electron share the same UI. Express capability differences through providers/context, not `isElectron` branches in components.

## Workbench

The workbench is the authoring surface inside an artifact page. Its configuration panes belong to the current artifact; artifact switching stays in the page header.

| Insight workbench | Responsibility                                                                          |
| ----------------- | --------------------------------------------------------------------------------------- |
| Left pane         | Configure the query: source, joins, fields, metrics, filters, sort, and viewer controls |
| Work canvas       | Show the insight result or selected visualization                                       |
| Right pane        | Configure the selected visualization: chart type, encodings, and appearance             |

Keep query settings in the left pane and chart settings in the right. Edit viewer controls on the items they expose; list them in a read-only rollup.

For the accepted grouping, pivot, and limit targets:

- Date-grouping chips read “order_date by month”.
- Pivot chips read “channel, as columns”. List derived columns such as “Revenue · Web” under their metric, including in Sort.
- Place limit at the bottom of Sort.

## Forms and panes

Use these control conventions in panes, dialogs, and inline editors. Section headers and jump bars apply to configuration panes:

- **Labels above controls.** Short fixed labels (X, Y, Color, Size) may share a line. Phrase controls (field · operator · value) may omit visible labels, but every input needs an associated label, `aria-labelledby`, or `aria-label`. Placeholders are hints, not labels.
- **Dashed means choose.** Unset selections and add rows use a dashed outline; set values use a solid outline of the same shape and token colour. Keep outlines subtle. Panel chrome stays borderless.
- **Inputs are wells; chips are flat.** Text inputs, search, selects, and unchecked checkboxes use `neutral-bg-subtle`, an inset shadow, and a low-alpha half-pixel `neutral-border` ring. Checked boxes drop the ring and fill primary. Chips, buttons, and toggles use flat fills in the same sub tone.
- **Editors float.** Open an anchored Popover without shifting the list below it.
- **Share sortable lists.** Use one primitive for drag handles, keyboard reorder, and removal. Show the named remove action on hover and keyboard focus. Each chip kind has its own content and editor. Keep short qualifiers inline; wrap long filters or join conditions onto a second line.
- **Chip states use neutral tones.** Rest, hover, and open deepen the fill slightly; open still reads as a chip, not a pressed button. Hover and open can coexist. Muted text promotes to secondary on hover/open for contrast.
- **Sections collapse.** Headers are full-width toggles with a muted icon, body-weight name, right chevron, and hover fill. Collapsed headers keep a one-line summary. Separate sections with a sub-tone hairline, not boxes.
- **Jump to sections.** Below the pane title, use ghost icon buttons matching section icons, ending with collapse-all. Each opens and jumps to its section. Give buttons accessible names and tooltips, no badges or selected state; several sections may stay open.
- **Keep hierarchy shallow.** Merge small sections into related ones. Name the pane in its header; name the artifact in the page header.

## Artifact pages

All artifact types share navigation, headers, action placement, and empty/loading/error states. Customize their content, not their shells.

**Collections:** share search, filters, sort, and a grid/list toggle. Default to grid when previews, recency, or ownership aid recognition; use list for compact names and metadata. Preserve the view choice per artifact type. Search names and relevant identity (provider, source, host, owner). Prioritize actionable failures, stale state, and drafts; keep routine healthy state quiet. Use comparison tables only when meaningful columns drive repeated comparisons.

**Details:** give the artifact the full content area, without a permanent artifact navigation rail. The header contains back/breadcrumb context, identity, relevant status, primary and overflow actions, and a compact switcher. The switcher is searchable, filterable, keyboard-accessible, and includes useful metadata plus **Browse all**.

Read order: state and next action → primary work → useful relationships/dependencies → activity and provenance. Use tabs or inspectors where sustained editing needs them. Keep editing spatially consistent with the read view.

**Narrow windows:** turn the switcher into a full-width command surface or sheet. Reduce grid columns before cards become cramped. List rows retain identity and their most important state. Stack detail sections; wide previews and data grids scroll locally, without page-level horizontal overflow.

## Content must help a decision

Every element must explain state, support a decision, or enable an action on that surface. Empty space is fine; decoration and repeated metadata must justify their place.

- Previews must show real artifact properties that help recognition or judgment.
- Show data the product can compute and keep current. “Health”, “quality”, or “freshness” needs a defined source and meaning; otherwise show the concrete fact.
- Fixtures must represent supported states and plausible data paths, without implying unsupported capabilities.
- Show badges and warnings where they affect the next action. For example, sensitivity belongs at share/export, not on every field in a picker. Tracking and enforcement do not require a visible badge everywhere.

Before adding an element, name the user question or action, why it belongs here, and its data source and stale/unavailable behavior. If removing it changes no decision, remove it.

## Accessibility and copy

Target WCAG AA. Keep all controls keyboard-reachable, including sidebar controls and assistant ⌘J summon/dismiss. Pair status colours with icons or labels. Respect `prefers-reduced-motion`; guard animation-frame work in non-visual runtimes.

Translate runtime errors into plain language with a recovery action; never expose WASM errors or stack traces in dialogs. Voice follows the knowledge vault's product principles and `prd/prd-dashframe-v02.md`. Reserve brand expression and marketing metadata for the marketing site.
