# Design — DashFrame

> Established: 2026-06-12
> Loaded by: Agent Kit plugin skills (frontend, polish, copywriting, ux-writing, discoverability)

## Register

**Product.** DashFrame's app UI is a working instrument — calm, functional, dense enough for real analysis. Brand register is reserved for the future marketing site; nothing in-app performs personality.

## Visual Direction

**References** (what to look like):

- **workforce** (sibling project) — the primary reference, taken deeply: floating surface panels on a tinted canvas, shadow-lifted rather than border-boxed, calm density, window chrome integrated with the sidebar. Where workforce and this document disagree, check workforce first — divergence should be deliberate.
- **@wystack/ui defaults** — the shared portfolio look. DashFrame customizes by exception, not by default.

**Anti-references** — _provisional, to be confirmed in use_:

- Enterprise BI chrome (Tableau/Power BI toolbar density)
- Generic uncustomized shadcn dashboard
- Notion-style document softness (artifacts are tools, not pages)
- Dark-mode-first hacker aesthetic

**Aesthetic adjective set**: calm, immediate, crafted. ("Immediate" is the drive-feel performance thesis made visual — the UI never feels like it's waiting on a server.)

## Theme

- **Mode**: both; default follows system.
- **Brand color (anchor)**: TBD — currently inherits `@wystack/ui` neutral primary `oklch(0.205 0 0)`. The hardcoded blue (`rgba(59,130,246,…)`) in the current nav is drift, not a decision; replace with tokens when touched.

## Tokens

`@wystack/ui` (vendored at `libs/stdui` — directory name is historical; the package and vocabulary are `@wystack/ui`) is the **source of truth**. This document records the mapping, never duplicates values. Token changes that aren't DashFrame-specific go upstream to the submodule.

### The surface system (canonical shell recipe)

The floating-panels look is built entirely from `@wystack/ui` surface tokens:

| Role           | Recipe                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Canvas         | `bg-surface-base` — tinted backdrop the panels float on (light: warm `oklch(0.95 0.006 70)`, dark: cool `oklch(0.2 0.005 250)`) |
| Panel geometry | `rounded-[var(--surface-radius)]` (10px), gaps and outer margins `var(--surface-inset)` (8px)                                   |
| Panel chrome   | `bg-neutral-bg/90 saturate-[1.2]` + `shadow-[var(--surface-shadow)]` — **no borders**; elevation separates panels from canvas   |

Every top-level shell region (nav, artifact, assistant) is one surface panel. Page content lives _inside_ a panel and never sets viewport-height (`h-screen`) — panels own their height.

### Everything else

Neutral scale (`neutral-bg*`, `neutral-fg*`, `neutral-border`), palette (`palette-primary`, `palette-danger`, …), radii, and shadows come straight from `@wystack/ui` tokens. The neutral scale stays chroma-free — tint belongs to the surface system only.

## Primitives

- **In active use** from `@wystack/ui`: Button, Dialog, DropdownMenu, Tooltip, Breadcrumb, Card, cn; icons from `@wystack/ui-icons`.
- **Local extensions** live in `packages/ui` (`@dashframe/ui`) — e.g. SensitivityBadge.
- **Rule**: don't restyle `@wystack/ui` primitives locally. If a primitive needs a different shape, upstream the change to the submodule (Rule of Three applies before generalizing).

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
