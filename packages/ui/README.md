# @dashframe/ui

Shared UI component library for DashFrame. Re-exports `@stdui/react` (design system) plus DashFrame-specific components.

## Installation

This package is part of the DashFrame monorepo:

```json
{
  "dependencies": {
    "@dashframe/ui": "workspace:*"
  }
}
```

## Overview

```
packages/ui/
├── src/
│   ├── components/       # DashFrame-specific components
│   ├── fields/           # Form field wrappers
│   ├── lib/
│   │   └── icons.tsx     # Icon re-exports from @stdui/icons
│   ├── globals.css       # Imports @stdui/react/styles + app fonts
│   └── index.ts          # Barrel exports (stdui + DashFrame components)
├── .storybook/           # Storybook v10 configuration
└── package.json
```

**Importing components:**

```typescript
import { Button, Card, Panel, Toggle, cn } from "@dashframe/ui";
import { RefreshIcon } from "@dashframe/ui/icons";
```

**Theme provider:**

```typescript
import { StduiProvider, useTheme } from "@dashframe/ui";

// In your root layout
<StduiProvider defaultMode="system" storageKey="dashframe">
  {children}
</StduiProvider>
```

**Storybook:** Run `bun storybook` to browse components at http://localhost:6006

## Architecture

`@dashframe/ui` is a thin re-export layer:

- **stdui primitives** (from `@stdui/react`) — Button, Card, Input, Select, Dialog, Badge, Tabs, etc.
- **stdui theme** (from `@stdui/react/theme`) — StduiProvider, useTheme
- **DashFrame components** — ItemSelector, VirtualTable, SortableList, Breadcrumb, JoinTypeIcon

All stdui components are re-exported via `export * from "@stdui/react"` in `index.ts`.

## Design Tokens

stdui uses semantic OKLCH-based tokens. Use these class names in Tailwind:

### Color Tokens

| Purpose             | Class pattern                               | Example                          |
| ------------------- | ------------------------------------------- | -------------------------------- |
| Neutral backgrounds | `bg-neutral-bg`, `bg-neutral-bg-muted`      | Page background, card background |
| Neutral text        | `text-neutral-fg`, `text-neutral-fg-subtle` | Body text, muted labels          |
| Neutral borders     | `border-neutral-border`                     | Dividers, card borders           |
| Neutral ring        | `ring-neutral-ring`                         | Focus rings                      |
| Palette colors      | `bg-palette-primary`, `text-palette-danger` | Accent, error states             |
| Surface             | `bg-neutral-bg-emphasis`                    | Hover/active backgrounds         |

### Spacing

| Level    | Classes        | Usage                     |
| -------- | -------------- | ------------------------- |
| Compact  | `p-4`, `gap-2` | Dense UIs (tables, lists) |
| Standard | `p-6`, `gap-4` | Most content              |
| Spacious | `p-8`, `gap-6` | Landing pages             |

### Border Radius

| Element         | Class          |
| --------------- | -------------- |
| Main cards      | `rounded-2xl`  |
| Nested elements | `rounded-xl`   |
| Badges/pills    | `rounded-full` |
| Inputs          | `rounded-lg`   |

### Icon Sizing

| Context          | Size        |
| ---------------- | ----------- |
| Inline with text | `h-4 w-4`   |
| Standalone       | `h-5 w-5`   |
| Section headers  | `h-6 w-6`   |
| Empty states     | `h-12 w-12` |

### Typography

- **No UPPERCASE** — use sentence case (except acronyms)
- Page titles: `text-2xl font-semibold`
- Section headers: `text-lg font-medium`
- Body text: `text-sm`
- Metadata: `text-xs text-neutral-fg-subtle`

### Colors

Use semantic tokens, not hardcoded colors:

```tsx
// Good
<p className="text-neutral-fg-subtle">...</p>
<div className="border-palette-primary">...</div>

// Avoid
<p className="text-gray-500">...</p>
```

## Component Philosophy

1. **stdui First** — use stdui primitives for standard UI patterns before custom components
2. **Composition Over Customization** — combine existing components rather than creating variants
3. **Extract When Patterns Emerge** — if you write similar JSX 3+ times, extract a shared component
4. **Semantic Naming** — name by purpose (what it does) not appearance (how it looks)
5. **Accessibility-First** — include semantic HTML, aria-labels, keyboard navigation

## Decision Framework

| Situation                                        | Use                         |
| ------------------------------------------------ | --------------------------- |
| Standard UI (buttons, inputs, modals)            | stdui primitives            |
| DashFrame-specific patterns used across features | DashFrame shared components |
| One-off domain-specific UI                       | Feature-specific components |

## Development

### Adding Components

- **stdui primitives** — add to `libs/stdui/` (separate repo/submodule)
- **DashFrame components** — add to `src/components/`, export from `src/index.ts`, add story

### Scripts

```bash
bun storybook        # Launch Storybook
bun build-storybook  # Build static Storybook
bun typecheck        # TypeScript checks
bun lint             # ESLint
bun format           # Prettier check
```

## Dependencies

**Production:** React 19, `@stdui/react` (design system), sonner

**Development:** Storybook v10, TypeScript 5.7, Tailwind CSS v4, PostCSS
