# Design — DashFrame

> Established: 2026-06-12
> Loaded by: Agent Kit plugin skills (frontend, polish, copywriting, ux-writing, discoverability)

## Register

**Product.** DashFrame's app UI is a working instrument — calm, functional, dense enough for real analysis. Brand register is reserved for the future marketing site; nothing in-app performs personality.

## Visual Direction

**References** (what to look like):

- **workforce** (sibling project) — the primary reference, taken deeply: floating surface panels on a tinted canvas, shadow-lifted rather than border-boxed, calm density, window chrome integrated with the sidebar. Where workforce and this document disagree, check workforce first — divergence should be deliberate.
- **@wystack/ui-core defaults** — the shared portfolio look. DashFrame customizes by exception, not by default.

**Anti-references** — _provisional, to be confirmed in use_:

- Enterprise BI chrome (Tableau/Power BI toolbar density)
- Generic uncustomized shadcn dashboard
- Notion-style document softness (artifacts are tools, not pages)
- Dark-mode-first hacker aesthetic

**Aesthetic adjective set**: calm, immediate, crafted. ("Immediate" is the drive-feel performance thesis made visual — the UI never feels like it's waiting on a server.)

## Vocabulary

> Accepted: 2026-09-09
> Applies to: UI copy, pane and page names, component and prop names

One word per concept, matching the artifact types in `@dashframe/types`. UI copy uses the left column; code uses the right. Do not introduce synonyms in copy ("question", "query", "report") for things that already have a name here.

| Word            | Means                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | In the model                                                                                                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data source     | A connection: a file, a database, a SaaS account.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `DataSource`                                                                                                                                                                                          |
| Table           | A table inside a data source. An insight's result can also be used as a table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `DataTable`, or an `Insight` as source                                                                                                                                                                |
| Insight         | A saved query: tables, fields, metrics, filters, sort, limit, viewer controls. Its result is a table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `Insight`                                                                                                                                                                                             |
| Field           | A column of the insight's tables. A selected date field also says how it is grouped: a granularity (day, week, month, quarter, year) or a date part (month of year, day of week, quarter of year). The chip reads "order_date by month". Any number of fields can be pivots: their values spread across columns instead of rows, one column per value per metric, nested in chip order; the chip reads "channel, as columns". A pivot is still a dimension, not a metric; the derived columns (Revenue · Web) appear under their metric wherever result columns are listed, such as Sort. | `Field`; grouping and pivot are not yet modeled on the insight (today `selectedFields` is an id list and date grouping lives as `DateTransform` on the chart encoding); this vocabulary is the target |
| Metric          | A saved aggregation on a table (sum of revenue). An insight picks metrics the way it picks fields.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `Metric`, `InsightMetric`                                                                                                                                                                             |
| Filter          | A condition rows must meet, read as a sentence: "channel is not beta".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `InsightFilter`                                                                                                                                                                                       |
| Viewer controls | Which filters, sort and limit a dashboard viewer may change. Edited on the item it exposes, listed as a read-only rollup.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `InsightRuntimeDeclaration`                                                                                                                                                                           |
| Visualization   | One chart of an insight's result: chart type, encodings, appearance. An insight can have many.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `Visualization`, `ChartEncoding`                                                                                                                                                                      |
| Dashboard       | An arrangement of visualizations and text, with its own controls.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `Dashboard`, `DashboardControl`                                                                                                                                                                       |

The insight page follows from this: the left pane is the insight config, the canvas shows the result or the selected visualization, the right pane is the visualization config.

## Form and pane conventions

> Accepted: 2026-09-09
> Applies to: every pane, dialog, and inline editor

- **Label above control.** A label sits on its own line above its control, so the control is full width and label length never sets a column width. A shared line is allowed only for a run of one-word fixed labels (X, Y, Color, Size). Controls that read as a phrase (aggregation · column, field · operator · value) carry no labels; the placeholder is the label.
- **Dashed means "choose".** Anything waiting for a selection carries a dashed border: add rows ("+ Add field"), an unset encoding ("None"), an empty sentence token. A solid border means a value is set. Same shape and colour as the filled state, only the border style changes. This is control state inside a pane; panel chrome itself stays borderless.
- **Fields are wells, chips are flat.** Every control that holds a value, text input, search field, select or the unchecked box of a checkbox, is a well: the sub tone (`neutral-bg-subtle`, called the sub tone below), an inset shadow, and a half-pixel ring in the neutral border token at low alpha (`neutral-border`, dark theme uses the light-on-dark counterpart). No full-strength border. A checked box drops the ring and fills primary. Chips, buttons and toggles are flat fills in the same sub tone, so recessed means "type or pick a value here" and flat means "a thing in a list". A fill difference alone does not read as editable.
- **Editors float, they do not push.** Editing a list item opens a Popover anchored to the item. Nothing below it moves. Inline expansion that shifts the list is not allowed.
- **Sections collapse, and a jump bar reaches them.** A section header is a full-width row: a muted icon matching its jump button, the name in body weight, a chevron at the right; the whole row toggles and takes a hover fill. Sections are separated by a hairline in the sub tone, never boxed. Every pane section collapses from its header; the collapsed header keeps a one-line summary. A row of ghost icon buttons under the pane title jumps to a section, opening it if collapsed, with a collapse-all button at the end. These are one-shot actions with no selected state: tabs or a segmented control would claim that only one section shows at a time, and they all show. Tooltips name the section; no counts or badges. Merge small sections (limit sits at the bottom of Sort) rather than wrap. The pane header is just the pane name; the artifact name lives in the page header.
- **Chips are per kind, lists are generic.** Sortable lists share one primitive (drag handle, hover ×, keyboard reorder); the chip inside is designed for its kind (table, field, metric, filter, sort) because each has its own editor. A chip is not limited to one line: a short qualifier stays inline with the name, a clause (a join condition, a long filter) takes a second line underneath, so nothing is truncated to fit. Chip state is three tonal steps of one neutral: rest, hover, and open (editor attached), each one step deeper, so hover and open can coexist and never need colour. Keep the steps light (rest barely off the panel, open still clearly a chip, never a pressed button); muted text promotes to secondary on hover and open so it keeps contrast on the deeper tones.

## Artifact navigation and page model

> Accepted: 2026-08-29
> Applies to: Data Sources, Insights, Visualizations, Dashboards, and future collection/detail artifact types

DashFrame uses one recognizable model for finding and working with artifacts. Collection pages share a list/grid index; detail pages give the selected artifact the full content width. Artifact types customize content and actions inside that structure rather than inventing their own navigation model.

### Collection pages: shared list/grid index

- Every artifact collection uses the same page header, search, filters, sort, view toggle, empty/loading/error states, and creation-action placement.
- **Grid is the default** when recognition, recency, ownership, or a meaningful preview helps selection. **List is the compact alternative** when names and metadata are sufficient. Preserve the user's view choice per artifact type.
- Search covers the artifact name plus type-relevant identity such as provider, source, host, or owner. Filters are artifact-specific but use the same interaction and placement.
- Results prioritize decision-changing state. “Needs attention,” failed, stale, or draft state may alter ordering or grouping; healthy routine state stays quiet.
- Tables are not the default artifact browser. Use a comparison table only when users repeatedly judge several artifacts across meaningful, decision-changing columns.

### Detail pages: full-width artifact home

- The selected artifact owns the content canvas. Do not reserve permanent horizontal space for an artifact list or master rail.
- The page header contains breadcrumb/back context, artifact identity, status when decision-relevant, primary action, overflow actions, and a compact artifact switcher.
- The artifact switcher is searchable and filterable, supports keyboard navigation, includes useful result metadata, and provides a **Browse all** path back to the shared collection index. It is a temporary navigation surface, not a persistent second sidebar.
- Detail content follows a consistent reading order:
  1. **State and summary** — what this artifact is, whether it needs attention, and the primary recovery or next action.
  2. **Primary work surface** — the visualization, dashboard, insight result/configuration, source schema/preview, or equivalent core task.
  3. **Relationships and impact** — upstream sources, downstream consumers, lineage, joins, or dependencies when useful.
  4. **Activity and provenance** — refreshes, edits, runs, failures, and ownership history.
- Sections may become tabs, inspectors, or editing modes when the artifact's core task requires sustained manipulation. These are local work surfaces; they do not replace the shared page anatomy.
- Editing preserves spatial continuity with the read view. Prefer contextual inspectors or in-place modes over navigating to a visually unrelated editor.

### Responsive behavior

- On narrow windows the artifact switcher becomes a full-width command surface or sheet; it never becomes a permanently visible rail.
- Collection grid columns collapse before content becomes cramped. List rows retain identity and the one most important state; secondary metadata may move into the detail page.
- Detail sections stack in reading order. Wide previews and data grids own explicit local horizontal scrolling rather than forcing page-level overflow.

### Rejected recurring directions

- **Permanent master-detail rails for every artifact.** They spend width on navigation that is idle during most artifact work and duplicate the application sidebar.
- **Comparison tables as the universal collection view.** Most artifact states are routine and not meaningfully comparable; repeated healthy columns create noise around exceptions.
- **Per-artifact collection and detail shells.** Artifact-specific content is expected, but search, switching, hierarchy, actions, states, and responsive behavior remain shared.

## Theme

- **Mode**: both; default follows system.
- **Brand color (anchor)**: TBD — currently inherits `@wystack/ui-core` neutral primary `oklch(0.205 0 0)`. The hardcoded blue (`rgba(59,130,246,…)`) in the current nav is drift, not a decision; replace with tokens when touched.

## Tokens

`@wystack/ui-core` (core tokens + utils, vendored at `libs/stdui` — directory name is historical) and `@wystack/ui-react` (React components) are the source of truth. The package and vocabulary split is: tokens/common in `@wystack/ui-core`, components in `@wystack/ui-react`. This document records the mapping, never duplicates values. Token changes go upstream to the submodule.

### The surface system (canonical shell recipe)

The floating-panels look is built entirely from `@wystack/ui-core` surface tokens:

| Role           | Recipe                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Canvas         | `bg-surface-base` — tinted backdrop the panels float on (light: warm `oklch(0.95 0.006 70)`, dark: cool `oklch(0.2 0.005 250)`) |
| Panel geometry | `rounded-[var(--surface-radius)]` (10px), gaps and outer margins `var(--surface-inset)` (8px)                                   |
| Panel chrome   | `bg-neutral-bg/90 saturate-[1.2]` + `shadow-[var(--surface-shadow)]` — **no borders**; elevation separates panels from canvas   |

Every top-level shell region (nav, artifact, assistant) is one surface panel. Page content lives _inside_ a panel and never sets viewport-height (`h-screen`) — panels own their height.

### Everything else

Neutral scale (`neutral-bg*`, `neutral-fg*`, `neutral-border`), palette (`palette-primary`, `palette-danger`, …), radii, and shadows come straight from `@wystack/ui-core` tokens. The neutral scale stays chroma-free — tint belongs to the surface system only.

## Primitives

- **In active use** from `@wystack/ui-react`: Button, Dialog, DropdownMenu, Tooltip, Breadcrumb, Card, cn; icons from `@wystack/ui-react/icons`; tokens and core from `@wystack/ui-core`.
- **Local extensions** live in `packages/ui` (`@dashframe/ui`) — e.g. SensitivityBadge.
- **Rule**: don't restyle `@wystack/ui-react` primitives locally. If a primitive needs a different shape, upstream the change to the submodule (Rule of Three applies before generalizing). Token changes go to `@wystack/ui-core`.

## Principle: a signal earns its surface

**A signal (badge, flag, indicator, warning) earns a place on a surface only if it changes the user's judgment _there_. If it doesn't change what they do, it's noise — and noise on many rows drowns the one signal that matters.**

Apply the test per surface, not per datum: the same fact can be signal on one surface and noise on another, because the user's _job_ differs. A classification surface (where the job is to resolve classification) should draw the eye to unresolved state; a consumption surface (where the job is to use the thing) should stay quiet about it and surface only what alters the choice being made.

Track always, enforce silently, flag only where it's decision-affecting. A property can be tracked on the model and enforced by the system without ever being shown — show it to the user only at the surface where it changes a decision with consequences.

- **Lesson (GH #81, 2026-06-13):** a per-field sensitivity badge in the insight field picker was built, reviewed clean, and _closed unmerged_ — at field-pick, sensitivity is informative, not decisive (a user who needs the field includes it regardless), and on a scan-list where most fields are unclassified the marker is wallpaper. Sensitivity is tracked on the field and enforced silently by the cache-write gate; the user-facing flag belongs at the **share/export boundary**, the one place it changes behavior (caution before sensitive data leaves the local context).

## Principle: every element earns its place

**An interface element exists to help the user understand state, make a decision, or perform an action. Visual completeness is not a reason to add it.**

- Do not add decorative KPIs, charts, thumbnails, cards, activity, metadata, status pills, filters, tabs, or actions merely to make a page look populated or polished.
- A preview must help recognize or judge the artifact. A generic chart thumbnail, arbitrary illustration, or synthetic sparkline that communicates no real artifact property is worse than no preview.
- Show only data the product can compute truthfully and keep current. Labels such as “health,” “impact,” “quality,” or “freshness” require a defined source and interpretation; otherwise use the underlying concrete fact.
- Demo and prototype content must represent a supported product state and plausible data path. It may use fixtures, but it must not imply unsupported analytics, automation, collaboration, monitoring, or lineage.
- Empty space is allowed. Do not fill it with low-value cards or repeated metadata. Increase density only when the additional information changes a decision on that surface.
- Repeated content must justify repetition. Identity and status may appear in a picker, header, and recovery state only when each placement supports a different local decision.

### Element review gate

Before an element graduates from a mock into production, answer:

1. What user question does it answer or what action does it enable?
2. Why is this the right surface and moment for it?
3. What real source supplies the content, and when can it be stale or unavailable?
4. What changes in the user's decision if the element is present?
5. If removing it changes nothing, remove it.

## Project-specific anti-patterns

- **Per-surface UI forks.** Web and Electron renderers are identical — the engine-placement tripwire's UI twin. No `isElectron` branches in components; capability differences ride through providers/context.
- **Off-token color.** No raw hex/rgb/oklch in classNames or styles (the nav's hardcoded blue shadow is standing drift). Tokens only — it's what keeps the future Appearance/tint feature a one-token override.
- **Raw runtime errors in user-facing UI.** Never surface Emscripten/WASM/stack strings in dialogs (GH #88's lesson) — translate to a human sentence plus a recovery action.
- **Viewport units inside panels.** `h-screen`/`min-h-screen` in page components breaks the surface system; use `h-full` within the panel's height chain.

## Accessibility

- **WCAG target**: AA for all app surfaces.
- **Reduced motion**: respected — gate decorative animation on `prefers-reduced-motion`; rAF-driven work must guard non-visual runtimes (perf HUD pattern from the shell PR).
- **Color-blindness**: status signals (sensitivity badges, gate states) never color-only — pair with icon or label.
- **Keyboard parity**: shell controls (sidebar collapse/hide, assistant ⌘J summon/dismiss) all keyboard-reachable.

## Discoverability defaults

N/A for the app shell. Marketing site (brand register) will own schema/OG/llms.txt when it exists.

## Voice

Owned by the product principles and PRD in the knowledge vault (`prd/prd-dashframe-v02.md`, product-principles). Not duplicated here.
