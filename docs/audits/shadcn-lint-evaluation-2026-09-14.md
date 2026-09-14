# @shadcn/lint evaluation

Measured 2026-09-14 against `origin/main` at `921b0fc` with Vite+ 0.3.2
(oxlint 1.82.0) and `@shadcn/lint` 0.1.0, the package's first release. This
is the record behind the `shadcn/*` block in `vite.config.ts`: what each rule
found, what was adopted, what was deferred and why. It follows the method in
`lint-guardrails-evaluation-2026-09-07.md`.

## Why

DESIGN.md says "tokens only, no raw colour values in styles or class names"
and "change shared primitives and tokens upstream, not through local
restyling". Nothing in the lint stack could check either sentence. oxlint sees
a Tailwind class as an opaque string; a misspelled token generates no CSS and
fails silently.

`@shadcn/lint` is a Tailwind-aware oxlint JS plugin. It reads the project's
theme (here, through `packages/ui/components.json`, which points at the
`@wystack/ui-react` styles) and checks class strings against it. It needs
oxlint 1.80+, which is why the Vite+ 0.3.2 upgrade landed first.

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
| `no-inline-styles`       |             53 |              17 | adopted; geometry allowed, 17 sites fixed      |
| `require-static-classes` |              4 |               4 | off; every finding is an unexpressible pattern |
| `no-arbitrary-values`    |            100 |              67 | off; needs a stdui type token first            |
| `no-restyle`             |            329 |              44 | off; needs stdui variants first                |

### Defects the adopted rules found on main

- `text-danger-fg` in `DataPickerContent.tsx` and `text-neutral-fg-disabled`
  in `OverridePopover.tsx` and `OverrideFieldRow.tsx` are not theme tokens.
  Tailwind emitted no CSS for them, so the import error line and the
  "default: …" hints under dashboard overrides rendered in the inherited
  colour. The real tokens are `text-palette-danger` and
  `text-neutral-fg-subtle`.
- `className="layout"` on the dashboard grid was a leftover from the
  react-grid-layout example and matched no CSS anywhere. Removed.

### Allow lists

`no-unknown-classes` allows `grid-drag-handle` (react-grid-layout's handle
selector) and `titlebar-drag-region` (the Electron titlebar hook). Both are
selectors owned by other systems, not Tailwind utilities.

`no-inline-styles` allows the geometry properties that are computed at
runtime: `width`, `height`, the min/max variants, `transform`, `transition`,
`top`, `left`, `gap`, `flex-basis`, and `grid-template-columns`. That covers
virtualizer rows in `VirtualTable`, chart dimensions in `Chart`, dnd-kit
transforms and prop-driven gaps in `SortableList`, and the Dock width. The
17 sites that set a static property inline (`display: grid`, `padding`,
`textAlign`, `fontSize`, `opacity`, `overflow`, `pointerEvents`) moved to
classes.

## Deferred

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

## Notes

- The plugin resolved the stdui theme with no extra configuration, so
  `no-unknown-classes` did not misfire on `bg-surface-base`, the neutral
  scale, or the palette tokens.
- `@shadcn/lint` declares `@typescript-eslint/parser` and `@eslint/core` as
  dependencies even on the oxlint path. They are install-time weight only;
  no ESLint config exists in this repo.
- The package is at 0.1.0. Re-measure on its next minor.
