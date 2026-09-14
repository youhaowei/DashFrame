# @shadcn/lint evaluation

Measured 2026-09-14 against `origin/main` at `921b0fc` with Vite+ 0.3.2
(oxlint 1.82.0) and `@shadcn/lint` 0.1.0, the package's first release. This
is the record behind the `shadcn/*` override in `vite.config.ts`: what each
rule found, what was adopted, what was deferred and why. It follows the method
in `lint-guardrails-evaluation-2026-09-07.md`.

## Why

DESIGN.md says "tokens only, no raw colour values in styles or class names"
and "change shared primitives and tokens upstream, not through local
restyling". Nothing in the lint stack could check either sentence. oxlint sees
a Tailwind class as an opaque string; a misspelled token generates no CSS and
fails silently.

`@shadcn/lint` is a Tailwind-aware oxlint JS plugin. It reads the project's
theme and checks class strings against it. It needs oxlint 1.80+, which is why
the Vite+ 0.3.2 upgrade landed first.

## Method

1. Wire the plugin as a `jsPlugins` entry and recognise components imported
   from `@wystack/ui-react` and `@dashframe/ui`.
2. Run all six rules at `warn` over `apps packages scripts e2e vite.config.ts`
   and count findings per rule.
3. Re-run with candidate allow lists and read the source behind what remains.
4. Adopt at `error` only, with the reason next to each decision.

## Findings

| Rule                     | Out of the box | With allow list | Decision                                       |
| ------------------------ | -------------: | --------------: | ---------------------------------------------- |
| `no-raw-colors`          |              6 |               6 | adopted; all six were real bugs                |
| `no-unknown-classes`     |              3 |               1 | adopted; two selectors allowed, one removed    |
| `no-inline-styles`       |             53 |              25 | adopted; six runtime properties allowed        |
| `require-static-classes` |              4 |               4 | off; every finding is an unexpressible pattern |
| `no-arbitrary-values`    |            100 |              67 | off; needs a stdui type token first            |
| `no-restyle`             |            329 |              44 | off; needs stdui variants first                |

These counts come from the first pass, before theme resolution was fixed for
`packages/visualization` and `apps/renderer` (see below). The second pass over
those two packages added two `no-raw-colors` findings, both in `Chart.tsx`.

### Theme resolution is per package

The plugin resolves the theme for each linted file by walking up to the
nearest `components.json`, or else scanning that file's own package for a
stylesheet that imports Tailwind. On main only `packages/ui` had a
`components.json`. `packages/app` and `apps/web` were covered because their
own `globals.css` imports the stdui theme. `packages/visualization` and
`apps/renderer` had neither, so `no-unknown-classes` and the token half of
`no-raw-colors` were inert there, and the first pass reported nothing for the
two shadcn-default names `bg-muted/30` and `text-muted-foreground` in
`Chart.tsx`.

Each JSX package now carries a `components.json` whose `tailwind.css` points
at `packages/ui/src/globals.css`, so every package checks against the same
theme. Verified by misspelling a token in each package and watching the rule
fire. The plugin is scoped through an `overrides` entry to the five packages
that contain JSX, so the other lint processes neither load the plugin nor
compile the theme.

### Defects the adopted rules found on main

- `text-danger-fg` in `DataPickerContent.tsx` and `text-neutral-fg-disabled`
  in `OverridePopover.tsx` and `OverrideFieldRow.tsx` are not theme tokens.
  Tailwind emitted no CSS for them, so the import error line and the
  "default: …" hints under dashboard overrides rendered in the inherited
  colour. The real tokens are `text-palette-danger` and
  `text-neutral-fg-subtle`.
- `bg-muted/30` and `text-muted-foreground` on the `Chart.tsx` loading box are
  shadcn's default theme names, which stdui never defines. The loading
  backdrop had no tint and the spinner inherited its colour. Now
  `bg-neutral-bg-muted/30` and `text-neutral-fg-subtle`.
- `className="layout"` on the dashboard grid was a leftover from the
  react-grid-layout example and matched no CSS anywhere. Removed.

### Allow lists

`no-unknown-classes` allows `grid-drag-handle` (react-grid-layout's handle
selector) and `titlebar-drag-region` (the Electron titlebar hook). Both are
selectors owned by other systems, not Tailwind utilities.

`no-inline-styles` exempts CSS custom properties by design, and its own
guidance for computed values is `style={{ "--x": value }}` plus a class that
reads `(--x)`. The allow list is kept to six properties whose values are
genuinely computed at runtime and where the custom-property form would only
add indirection: `width` and `height` (chart dimensions, the Dock width,
virtualizer totals), `transform` and `transition` (dnd-kit and virtualizer
rows), `gap` (a `SortableList` prop), and `grid-template-columns` (the
`VirtualTable` column template). Every property outside that list is an
error. The 25 sites the first pass left behind were resolved as follows:

- Static values moved to classes: `display: grid`, `minWidth: max-content`,
  `width: 100%`, `minWidth: fit-content` in `VirtualTable`; `padding`,
  `textAlign`, `fontSize`, `opacity`, `minHeight`, `overflow`,
  `pointerEvents` in `Chart`; `maxHeight: 300` and `height: 260` in
  `JoinConfigureContent`.
- Computed values moved to custom properties: `maxHeight`/`maxWidth` from the
  `maxSize` prop in `SortableList`, and the container `maxHeight` in
  `VirtualTable`.
- Kept inline under the allow list: the rest.

## Deferred

The deferred rules are simply not named in the override. jsPlugin rules are
off unless listed, so an explicit `"off"` would configure nothing.

### `no-arbitrary-values` (67)

With `*-[var(--*` allowed, so that `rounded-[var(--surface-radius)]` and
`shadow-[var(--surface-shadow)]` from DESIGN.md pass, 67 findings remain.
33 of them are `text-[10px]` and `text-[11px]` on dense table and badge text.
That is one missing type-scale token in stdui, not 33 local fixes. The rest
are one-off widths and heights (`max-h-[80vh]`, `min-w-[220px]`) that need a
per-site look. Revisit once stdui ships a small text token.

### `no-restyle` (329 / 44)

With only `layout` allowed, 329 className overrides on stdui components. With
`spacing`, `typography`, and `color` allowed too, 44 remain, all `shape`,
`motion`, and `effects` overrides. The largest clusters point at variants
stdui does not have yet:

| Class                    | Count | Where                                  |
| ------------------------ | ----: | -------------------------------------- |
| `text-xs`                |    54 | `SelectTrigger`, `SelectItem`, `Label` |
| `text-neutral-fg-subtle` |    49 | `Label`, `Badge`, `Button`             |
| `text-palette-danger`    |    16 | destructive `Button`, icons            |
| `px-1.5`                 |    14 | `Badge`                                |

DESIGN.md already says to push these upstream. Adopting the rule is a stdui
change (a small select size, a subtle label tone, a danger button tone) followed
by a sweep here, or a set of per-component contracts. Either is a design
decision, not a lint PR.

### `require-static-classes` (4)

Two sites merge an imported class constant
(`groupHoverAndFocusWithinReveal`, `DESKTOP_NAV_BREAKPOINT_CLASS`) and two
forward `SortableList`'s `itemClassName` prop. The rule only reads same-file
constants and props literally named `className`, so all four would be
suppressions. Not worth adopting for zero net coverage.

## Review findings dismissed

- Pinning `@typescript-eslint/parser` to the version already in the tree to
  collapse a duplicated `typescript-estree` subtree. The plugin never loads
  that parser when `oxc-parser` is present, so the duplicate is install-time
  weight only; an override for a dependency nothing imports is not worth
  carrying.
- `text-palette-danger` in `apps/renderer/src/main.tsx` is outside every
  Tailwind `@source`, so its CSS exists only because other scanned files use
  the class. Pre-existing and out of scope for a lint change; noted so the
  next `no-restyle` sweep does not remove the last scanned use by accident.

## Notes

- `no-unknown-classes` compiles the full stdui theme in a worker thread once
  per lint process. With the plugin scoped to five packages that is five
  compiles per uncached gate rather than twenty-five; a single-root lint
  invocation would bring it to one.
- `@shadcn/lint` declares `@typescript-eslint/parser` and `@eslint/core` as
  dependencies even on the oxlint path. No ESLint config exists in this repo.
- The package is at 0.1.0. Re-measure on its next minor.
