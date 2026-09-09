# DashFrame design

How DashFrame's UI looks and behaves. **This file is product design.** The framework design system — tokens, primitives, the shared visual language across the portfolio — lives in `libs/stdui` and is not restated here.

See [PRODUCT.md](PRODUCT.md) for what the product is and what it refuses to be, and [GLOSSARY.md](GLOSSARY.md) for product vocabulary and model caveats.

## Direction

**The primary reference is workforce**, the sibling project, taken deeply: floating surface panels on a tinted canvas, shadow-lifted rather than border-boxed, calm density, window chrome integrated with the sidebar. Where workforce and this document disagree, check workforce first — divergence should be deliberate.

`@wystack/ui-core` defaults are the shared portfolio look. DashFrame customizes by exception, not by default.

Anti-references, _provisional, to be confirmed in use_: enterprise BI chrome (Tableau/Power BI toolbar density); a generic uncustomized shadcn dashboard; Notion-style document softness (artifacts are tools, not pages); a dark-mode-first hacker aesthetic.

The adjective set is **calm, immediate, crafted**. "Immediate" is the performance commitment made visual — the UI never feels like it is waiting on a server.

Support light and dark themes; follow the system by default. Brand colour is undecided; use the shared neutral primary.

## Shared components and surfaces

Tokens and utilities come from `@wystack/ui-core`; components from `@wystack/ui-react`; icons from `@wystack/ui-react/icons`. Both packages are vendored in `libs/stdui`. Local extensions belong in `packages/ui` (`@dashframe/ui`) — for example `SensitivityBadge`. Change shared primitives and tokens upstream, not through local restyling; generalize after three uses.

In active use from `@wystack/ui-react`: Button, Dialog, DropdownMenu, Tooltip, Breadcrumb, Card, and `cn`. Check here before building a primitive that may already exist.

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

**Rejected directions.** These recur; they stay rejected.

- _Permanent master-detail rails for every artifact._ They spend width on navigation that is idle during most artifact work, and duplicate the application sidebar.
- _Comparison tables as the universal collection view._ Most artifact states are routine and not meaningfully comparable; repeated healthy columns create noise around the exceptions.
- _Per-artifact collection and detail shells._ Artifact-specific content is expected, but search, switching, hierarchy, actions, states, and responsive behavior stay shared.

## Content must help a decision

[PRODUCT.md](PRODUCT.md) commits to showing only what the product can compute truthfully. In the UI that means every element must explain state, support a decision, or enable an action **on that surface**.

- Previews must show real artifact properties that help recognition or judgment. A generic chart thumbnail or synthetic sparkline is worse than no preview.
- “Health”, “quality”, or “freshness” needs a defined source and meaning; otherwise show the concrete fact.
- Fixtures must represent supported states and plausible data paths, without implying unsupported capabilities.
- Repeated content must justify repetition. Identity and status may appear in a picker, header, and recovery state only when each placement supports a different local decision.

Before adding an element, name the user question or action, why this is the right surface and moment, and its data source and stale/unavailable behavior. If removing it changes no decision, remove it.

**Worked example (GH #81, 2026-06-13).** A per-field sensitivity badge in the insight field picker was built, reviewed clean, and closed unmerged. At field-pick, sensitivity is informative but not decisive — a user who needs the field includes it regardless — and on a scan-list where most fields are unclassified, the marker is wallpaper. Sensitivity is classified on the field and surfaced where it is decision-affecting — the remote-import review gate, and the share/export boundary where data leaves the local context.

## Accessibility and copy

Target WCAG AA. Keep all controls keyboard-reachable, including sidebar controls and assistant ⌘J summon/dismiss. Pair status colours with icons or labels. Respect `prefers-reduced-motion`; guard animation-frame work in non-visual runtimes.

Translate runtime errors into plain language with a recovery action; never expose WASM errors or stack traces in dialogs. Voice follows [PRODUCT.md](PRODUCT.md) — a working instrument, not a document. Reserve brand expression and marketing metadata for the marketing site.

## Do's and Don'ts

- **Do** check workforce first when this document is silent or disagrees.
- **Do** put token and primitive changes upstream in `libs/stdui`, not in local overrides.
- **Do** let panels own their height and let pages fill them with `h-full`.
- **Do** leave empty space when nothing decision-changing fills it.
- **Do** name the decision an element serves before adding it.
- **Don't** use raw colour values in styles or class names — tokens only.
- **Don't** put a border on panel chrome; elevation separates panels from the canvas.
- **Don't** branch on `isElectron` inside components.
- **Don't** add a permanent master-detail rail, a per-artifact page shell, or a comparison table as a default collection view.
- **Don't** show a badge on every row when it changes the decision on only one surface.
- **Don't** ship a metric the product cannot compute and keep current.
- **Don't** use a placeholder as a control's only label.
