# @dashframe/ui

Shared UI component library for DashFrame, built with React, TypeScript, Tailwind CSS v4, and Radix UI.

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
│   ├── primitives/       # shadcn/ui components (23 components)
│   ├── components/       # Custom shared components (11 components)
│   ├── lib/
│   │   ├── utils.ts     # cn() utility for className merging
│   │   └── icons.tsx    # Icon exports from react-icons
│   ├── globals.css      # Tailwind CSS v4 design tokens
│   └── index.ts         # Barrel exports
├── .storybook/          # Storybook v10 configuration
└── package.json
```

**Importing components:**

```typescript
import { Button, Card, Panel, Toggle, cn } from "@dashframe/ui";
import { RefreshCw } from "@dashframe/ui/icons";
```

**Storybook:** Run `pnpm storybook` to browse components at http://localhost:6006

## Component Philosophy

1. **shadcn/ui First** - Use shadcn/ui for standard UI patterns before custom components
2. **Composition Over Customization** - Combine existing components rather than creating variants
3. **Extract When Patterns Emerge** - If you write similar JSX 3+ times, extract a shared component
4. **Semantic Naming** - Name by purpose (what it does) not appearance (how it looks)
5. **Accessibility-First** - Include semantic HTML, aria-labels, keyboard navigation

## Component Inventory

### shadcn/ui Primitives (`src/primitives/`)

Standard UI components built on Radix UI:

| Category         | Components                                                                |
| ---------------- | ------------------------------------------------------------------------- |
| **Actions**      | `button`, `dropdown-menu`                                                 |
| **Forms**        | `checkbox`, `field`, `input`, `label`, `select`, `switch`, `multi-select` |
| **Data Display** | `badge`, `table`, `tabs`, `separator`, `scroll-area`                      |
| **Feedback**     | `alert`, `sonner` (toasts), `tooltip`                                     |
| **Layout**       | `dialog`, `collapsible`, `navigation-menu`, `surface`                     |

#### Surface Component

Primitive for standardized elevation and visual depth:

```tsx
// Elevation variants: plain, raised (default), floating, inset
<Surface elevation="raised" className="p-6">Content</Surface>
<Surface elevation="inset" className="p-8 text-center">Empty state</Surface>
<Surface elevation="floating" interactive className="p-4">Clickable card</Surface>
```

### Custom Shared Components (`src/components/`)

DashFrame-specific reusable patterns:

| Component              | Purpose                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| **Card**               | Enhanced content grouping with headers/footers (uses Surface)    |
| **Panel**              | Full-height layouts with fixed header/footer, scrollable content |
| **ActionGroup**        | Universal button group with icons, variants, compact mode        |
| **ItemSelector**       | Item selection with tabs, metadata, badges                       |
| **CollapsibleSection** | Wrapper for collapsible content                                  |
| **CollapseHandle**     | Visual affordance for collapsible areas                          |
| **Toggle**             | View/mode switching                                              |
| **Stack**              | Flexible vertical/horizontal layout                              |
| **EmptyState**         | Standardized empty state pattern                                 |
| **Container**          | Max-width content container                                      |
| **Tooltip**            | Custom tooltip wrapper                                           |

## Usage Examples

### ActionGroup

```tsx
<ActionGroup
  actions={[
    { label: "Create", icon: Plus, onClick: handleCreate, variant: "default" },
    {
      label: "Delete",
      icon: Trash2,
      onClick: handleDelete,
      variant: "destructive",
    },
  ]}
  compact={false}
/>
```

### ItemSelector

```tsx
<ItemSelector
  items={dataSources}
  selectedId={selectedId}
  onSelect={setSelectedId}
  getItemKey={(ds) => ds.id}
  getItemLabel={(ds) => ds.name}
  getItemMetadata={(ds) => ds.type}
  getItemIcon={(ds) => getIcon(ds.type)}
/>
```

### Panel with Sections

```tsx
<Panel header={<h2>Settings</h2>} footer={<Button>Save</Button>}>
  <PanelSection title="General" description="Basic options">
    <div>Settings content</div>
  </PanelSection>
  <PanelSection title="Advanced">
    <div>Advanced options</div>
  </PanelSection>
</Panel>
```

### EmptyState

```tsx
<EmptyState
  icon={Database}
  title="No data sources"
  description="Get started by adding your first data source"
  action={{ label: "Add data source", onClick: handleCreate }}
/>
```

### Stack Layout

```tsx
<Stack direction="vertical" spacing="lg">
  <h1>Page Title</h1>
  <Stack direction="horizontal" spacing="sm" align="center">
    <Icon className="h-4 w-4" />
    <span>Metadata</span>
  </Stack>
  <Card>Content</Card>
</Stack>
```

## Design Tokens

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

- **No UPPERCASE** - Use sentence case (except acronyms)
- Page titles: `text-2xl font-semibold`
- Section headers: `text-lg font-medium`
- Body text: `text-sm`
- Metadata: `text-xs text-muted-foreground`

### Colors

Use semantic tokens, not hardcoded colors:

```tsx
// Good
<p className="text-muted-foreground">...</p>

// Avoid
<p className="text-gray-500">...</p>
```

## Decision Framework

### When to Use What

| Situation                                        | Use                         |
| ------------------------------------------------ | --------------------------- |
| Standard UI (buttons, inputs, modals)            | shadcn/ui primitives        |
| DashFrame-specific patterns used across features | Custom shared components    |
| One-off domain-specific UI                       | Feature-specific components |

### When to Extract to Shared

Extract when:

- Pattern is used 3+ times across features
- Component encapsulates meaningful UI logic
- Component has clear, semantic purpose

## Accessibility

- Icon-only buttons require `aria-label`
- Form inputs need proper `<label>` elements
- Loading states use `aria-busy`, `aria-live` regions
- All interactive elements accessible via keyboard
- Follow WCAG AA color contrast

## Development

### Adding Components

1. Create in `src/primitives/` (shadcn/ui) or `src/components/` (custom)
2. Export from `src/index.ts`
3. Add story with `.stories.tsx` suffix
4. Document with JSDoc

### Scripts

```bash
pnpm storybook        # Launch Storybook
pnpm build-storybook  # Build static Storybook
pnpm typecheck        # TypeScript checks
pnpm lint             # ESLint
pnpm format           # Prettier check
```

## Dependencies

**Production:** React 19, Radix UI (12 packages), react-icons, class-variance-authority, clsx, tailwind-merge, next-themes, sonner

**Development:** Storybook v10, TypeScript 5.7, Tailwind CSS v4, PostCSS
