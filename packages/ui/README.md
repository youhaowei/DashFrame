# @dashframe/ui

Shared UI component library for DashFrame, built with React, TypeScript, Tailwind CSS v4, and Radix UI.

## Overview

This package provides a comprehensive set of UI components used across the DashFrame application:

- **23 shadcn/ui primitives** - Standard UI components built on Radix UI (Button, Card, Dialog, Select, etc.)
- **11 custom shared components** - DashFrame-specific patterns (ActionGroup, ItemSelector, Panel, Toggle, etc.)
- **Icon library** - Curated exports from react-icons (Lucide, Feather, Simple Icons)
- **Utilities** - `cn()` for className merging with tailwind-merge
- **Design tokens** - Tailwind CSS v4 configuration with consistent spacing, colors, and typography

## Installation

This package is part of the DashFrame monorepo and uses workspace dependencies:

```json
{
  "dependencies": {
    "@dashframe/ui": "workspace:*"
  }
}
```

## Usage

Import components from the package root:

```typescript
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Input,
  Label,
  Panel,
  ActionGroup,
  Toggle,
  cn,
  RefreshCw,
  CheckIcon,
} from "@dashframe/ui";
```

### Examples

#### Using primitives

```typescript
import { Button, Input, Label } from "@dashframe/ui";

export function LoginForm() {
  return (
    <form className="space-y-4">
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" />
      </div>
      <Button type="submit">Sign in</Button>
    </form>
  );
}
```

#### Using shared components

```typescript
import { Panel, ActionGroup } from "@dashframe/ui";
import type { ItemAction } from "@dashframe/ui";

export function DataPanel() {
  const actions: ItemAction[] = [
    { label: "Refresh", icon: "refresh", onClick: handleRefresh },
    { label: "Delete", icon: "trash", variant: "destructive", onClick: handleDelete },
  ];

  return (
    <Panel footer={<ActionGroup actions={actions} />}>
      <p>Panel content here</p>
    </Panel>
  );
}
```

#### Using icons

```typescript
import { RefreshCw, CheckIcon, XIcon } from "@dashframe/ui";

export function StatusIndicator({ status }: { status: "loading" | "success" | "error" }) {
  if (status === "loading") return <RefreshCw className="h-4 w-4 animate-spin" />;
  if (status === "success") return <CheckIcon className="h-4 w-4 text-green-500" />;
  return <XIcon className="h-4 w-4 text-red-500" />;
}
```

## Component Categories

### Primitives (`src/primitives/`)

Standard UI components based on shadcn/ui and Radix UI:

- **Actions**: Button, DropdownMenu
- **Forms**: Checkbox, Field, Input, Label, Select, Switch, MultiSelect
- **Data Display**: Badge, Table, Tabs, Separator, ScrollArea
- **Feedback**: Alert, Tooltip
- **Layout**: Card, Dialog, Collapsible, NavigationMenu, Surface

### Shared Components (`src/components/`)

DashFrame-specific reusable patterns:

- **ActionGroup** - Universal button group renderer with icons and variants
- **ItemSelector** - Universal item selection pattern with tabs and metadata
- **Panel** - Container component with optional header and footer
- **Toggle** - Multi-option toggle/segmented control
- **CollapsibleSection** - Wrapper for collapsible content areas
- **CollapseHandle** - Visual affordance for collapsible areas
- **Container**, **Stack**, **EmptyState**, **Card**, **Tooltip**

### Icons (`src/lib/icons.tsx`)

Curated icon exports from react-icons with semantic names:

- **Navigation**: ChevronDown, ChevronUp, ArrowUpDown, Menu
- **Actions**: Plus, Edit3, Delete, Refresh, Close
- **Data**: Table, Chart, Database, File
- **UI**: Check, X, Circle, Hash, Calendar, Type
- **Integrations**: Notion

All icons export both specific names (e.g., `RefreshCw`) and generic aliases (e.g., `Refresh`).

## Development

### Storybook

Browse all components interactively with Storybook v10:

```bash
pnpm storybook
```

This launches Storybook at http://localhost:6006 with:
- Interactive component examples
- Props documentation
- Multiple variants and states
- Dark mode toggle

### Adding New Components

1. **Create the component** in `src/primitives/` (for shadcn/ui) or `src/components/` (for custom)
2. **Add exports** to `src/index.ts`
3. **Create a story** in the same directory with `.stories.tsx` suffix
4. **Document with JSDoc** including usage examples

Example story structure:

```typescript
import type { Meta, StoryObj } from "@storybook/react";
import { MyComponent } from "./my-component";

const meta = {
  title: "Components/MyComponent",
  component: MyComponent,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof MyComponent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    // component props
  },
};
```

### TypeScript

All components are written in TypeScript with strict mode enabled. The package exports TypeScript source directly (no build step) for optimal hot reload in the Next.js app.

### Styling

Components use Tailwind CSS v4 with PostCSS processing. Design tokens are defined in `src/globals.css`:

- **Colors**: CSS variables with light/dark mode support
- **Spacing**: Consistent scale (p-4, p-6, p-8)
- **Border radius**: rounded-2xl (main cards), rounded-xl (nested), rounded-full (badges)
- **Typography**: Defined font families and sizes

## Scripts

```bash
pnpm storybook        # Launch Storybook dev server
pnpm build-storybook  # Build static Storybook
pnpm typecheck        # Run TypeScript checks
pnpm lint             # Run ESLint
pnpm format           # Check code formatting
```

## Dependencies

### Production

- **React 19** - UI library
- **Radix UI** - Headless component primitives (12 packages)
- **react-icons** - Icon library (Lucide, Feather, Simple Icons)
- **class-variance-authority** - Component variant management
- **clsx** + **tailwind-merge** - ClassName utilities
- **next-themes** - Dark mode support
- **sonner** - Toast notifications

### Development

- **Storybook v10** - Component development environment
- **TypeScript 5.7** - Type checking
- **Tailwind CSS v4** - Utility-first CSS framework
- **PostCSS** - CSS processing

## Architecture

This package follows DashFrame's component philosophy:

1. **shadcn/ui first** - Use standard primitives for common UI patterns
2. **Composition over customization** - Combine components rather than creating variants
3. **Extract when patterns emerge** - Share components used 3+ times
4. **Semantic naming** - Name by purpose, not appearance
5. **Accessibility-first** - Include aria-labels and keyboard navigation

See `docs/ui-components.md` for comprehensive component documentation.

## License

Private package - part of the DashFrame monorepo.
