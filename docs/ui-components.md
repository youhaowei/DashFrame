# UI Components

This document provides comprehensive guidance on UI components in DashFrame, covering our design system, component inventory, and principles for creating reusable components.

## Component Philosophy

**Principles-Based Approach**: We favor judgment and composition over rigid rules. The goal is to build a consistent, maintainable UI through thoughtful component reuse, not through enforcement.

### Core Principles

1. **shadcn/ui First**: Use shadcn/ui components for standard UI patterns before creating custom components
2. **Composition Over Customization**: Combine existing components rather than creating specialized variants
3. **Extract When Patterns Emerge**: If you write similar JSX 3+ times, consider extracting a shared component
4. **Semantic Naming**: Name components by purpose (what they do) rather than appearance (how they look)
5. **Document Reusable Components**: All shared components should have JSDoc documentation with usage examples
6. **Accessibility-First**: Include semantic HTML, aria-labels, and keyboard navigation by default

## Component Inventory

### shadcn/ui Components (`components/ui/`)

**Standard UI primitives built on Radix UI.**

- **Actions**: `button`, `dropdown-menu`
- **Forms**: `checkbox`, `field`, `input`, `label`, `select`, `switch`, `multi-select`
- **Data Display**: `badge`, `card`, `table`, `tabs`, `separator`, `scroll-area`
- **Feedback**: `alert`, `sonner` (toast notifications), `tooltip`
- **Layout**: `dialog`, `collapsible`, `navigation-menu`

**When to use**: These are your building blocks. Use them for all standard UI patterns (buttons, inputs, cards, modals, etc.). They provide consistent styling, accessibility, and behavior out of the box.

### Custom Shared Components (`components/shared/`)

**DashFrame-specific reusable patterns.**

- **`ActionGroup`** - Universal button group renderer with icons, variants, and compact mode
  - Use for: Consistent action button groups throughout the app
  - Example: Create/Delete buttons, Save/Cancel buttons, toolbar actions

- **`ItemSelector`** - Universal item selection pattern with tabs, metadata, badges
  - Use for: Selecting items from collections (data sources, insights, dataframes)
  - Supports: Compact/expanded views, icons, metadata display, badge indicators

- **`CollapsibleSection`** - Wrapper for collapsible content areas
  - Use for: Collapsible panels, accordion-style sections
  - Provides: Consistent collapse/expand UI pattern

- **`CollapseHandle`** - Visual affordance for collapsible areas
  - Use for: Indicating expandable/collapsible content
  - Pairs with: CollapsibleSection component

- **`SidePanel`** - Reusable side panel layout
  - Use for: Consistent side panel UI (settings, filters, details)
  - Provides: Standard panel structure and animations

- **`Toggle`** - Custom toggle component for view switching
  - Use for: Switching between modes/views
  - Example: Grid/List view toggle, Edit/Preview toggle

- **`Tooltip`** - Custom tooltip wrapper
  - Use for: Contextual help text and clarifications
  - Note: Consider using shadcn/ui `tooltip` instead for standard cases

- **`Stack`** - Flexible layout component for vertical/horizontal stacking
  - Use for: Replacing `<div className="flex flex-col gap-*">` patterns
  - Supports: Direction, spacing, alignment props

- **`EmptyState`** - Standardized empty state pattern
  - Use for: Empty data tables, empty collections, no results states
  - Provides: Consistent icon, message, and action button layout

- **`Container`** - Max-width content container
  - Use for: Consistent content width and padding across pages
  - Provides: Responsive container with standard padding

### Feature-Specific Components

Components in `components/data-sources/`, `components/visualizations/`, `components/fields/`, etc. are feature-specific and shouldn't be reused outside their domain unless extracted to shared/.

## Component Categories

### Layout Components

**Purpose**: Structure and organize page content

- **From shadcn/ui**: `card`, `separator`, `scroll-area`
- **Custom shared**: `Stack`, `Container`, `SidePanel`

**Pattern**: Use Card for content grouping, Stack for vertical/horizontal layouts, Container for max-width constraints.

```tsx
// Good - Using layout components
<Container>
  <Stack direction="vertical" spacing="lg">
    <Card>
      <Stack direction="horizontal" spacing="sm">
        <Icon />
        <Text>Content</Text>
      </Stack>
    </Card>
  </Stack>
</Container>

// Avoid - Custom div wrappers
<div className="max-w-7xl mx-auto px-6">
  <div className="flex flex-col gap-6">
    <div className="rounded-2xl border p-6">
      <div className="flex items-center gap-2">
        <Icon />
        <span>Content</span>
      </div>
    </div>
  </div>
</div>
```

### Data Display Components

**Purpose**: Present data and content to users

- **From shadcn/ui**: `table`, `badge`, `tabs`, `card`
- **Custom shared**: `ItemSelector`, `EmptyState`

**Pattern**: Use Table for tabular data, ItemSelector for selectable collections, EmptyState for no-data scenarios.

### Form Components

**Purpose**: Collect user input

- **From shadcn/ui**: `input`, `select`, `checkbox`, `switch`, `label`, `multi-select`
- **Custom**: `Field` (from `components/fields/`)

**Pattern**: Compose form fields with Label + Input/Select. Use Field component for consistent field layouts with labels and validation.

### Action Components

**Purpose**: Trigger operations and navigate

- **From shadcn/ui**: `button`, `dropdown-menu`
- **Custom shared**: `ActionGroup`, `Toggle`

**Pattern**: Use Button for single actions, ActionGroup for related action sets, DropdownMenu for overflow actions.

### Feedback Components

**Purpose**: Provide user feedback and status

- **From shadcn/ui**: `alert`, `sonner`, `tooltip`
- **Custom shared**: `EmptyState`

**Pattern**: Use Sonner for transient notifications, Alert for persistent messages, Tooltip for contextual help.

### Navigation Components

**Purpose**: Move between views and sections

- **From shadcn/ui**: `navigation-menu`, `tabs`, `collapsible`
- **Custom shared**: `CollapsibleSection`, `CollapseHandle`

**Pattern**: Use Tabs for view switching within a page, NavigationMenu for site navigation, CollapsibleSection for expandable content.

## Design Tokens

Follow these design tokens for consistent visual language across the application.

### Spacing

- **Compact**: `p-4`, `gap-2`, `space-y-2`
- **Standard**: `p-6`, `gap-4`, `space-y-4`
- **Spacious**: `p-8`, `gap-6`, `space-y-6`

**Usage**: Use compact spacing for dense UIs (tables, lists), standard for most content, spacious for landing pages and marketing content.

### Border Radius

- **Main cards**: `rounded-2xl`
- **Nested elements**: `rounded-xl`
- **Badges/pills**: `rounded-full`
- **Inputs**: `rounded-lg`

**Rationale**: Larger radius on main containers creates visual hierarchy. Nested elements use slightly smaller radius to distinguish from parents.

### Icon Sizing

- **Inline with text**: `h-4 w-4`
- **Standalone**: `h-5 w-5`
- **Section headers**: `h-6 w-6`
- **Empty states**: `h-12 w-12` or larger

**Consistency**: Always use Lucide React icons (`lucide-react` package). Maintain consistent sizing within the same context.

### Typography

- **No UPPERCASE text**: Use sentence case everywhere (except acronyms like CSV, API, URL)
- **Semantic heading levels**: Use `h1`-`h6` elements with Tailwind classes for styling
- **Text hierarchy**:
  - Page titles: `text-2xl font-semibold`
  - Section headers: `text-lg font-medium`
  - Body text: `text-sm` (default)
  - Metadata: `text-xs text-muted-foreground`

### Color System

Uses CSS custom properties for theming with dark mode support:

- **Primary**: `bg-primary`, `text-primary`, `border-primary`
- **Secondary**: `bg-secondary`, `text-secondary`
- **Muted**: `bg-muted`, `text-muted-foreground`
- **Destructive**: `bg-destructive`, `text-destructive-foreground`
- **Accent**: `bg-accent`, `text-accent-foreground`

**Pattern**: Use semantic color tokens rather than hardcoded colors (e.g., `text-muted-foreground` instead of `text-gray-500`).

## Decision Framework

### When to Use shadcn/ui Components

**Use shadcn/ui when**:
- The UI pattern is standard across applications (buttons, inputs, cards, modals)
- You need accessibility and keyboard navigation out of the box
- The component exists in `components/ui/`

**Examples**: Button, Input, Select, Dialog, Alert, Badge, Table

### When to Use Custom Shared Components

**Use custom shared components when**:
- The pattern is specific to DashFrame but used across features
- You need domain-specific composition (e.g., ItemSelector for data sources/insights/dataframes)
- The component encapsulates DashFrame-specific behavior

**Examples**: ActionGroup, ItemSelector, CollapsibleSection, EmptyState

### When to Create Feature-Specific Components

**Create feature-specific components when**:
- The component is only used in one feature area
- The component has domain-specific logic (e.g., visualization rendering, CSV parsing UI)
- The component is unlikely to be reused elsewhere

**Location**: `components/data-sources/`, `components/visualizations/`, `components/fields/`

### When to Extract to Shared

**Extract to `components/shared/` when**:
- Pattern is used in 3+ places across different features
- Component encapsulates meaningful UI logic (not just styling)
- Component has clear, semantic purpose
- You can document it with clear usage examples

**Process**:
1. Identify repeated pattern across features
2. Extract to `components/shared/<ComponentName>.tsx`
3. Add JSDoc documentation with usage examples
4. Add TypeScript props interface with comments
5. Refactor existing usage to use new shared component
6. Update this documentation

## Real Examples from Codebase

### Example 1: ActionGroup Pattern

**Good - Using ActionGroup**:
```tsx
import { ActionGroup } from "@/components/shared/ActionGroup"

<ActionGroup
  actions={[
    {
      label: "Create",
      icon: Plus,
      onClick: handleCreate,
      variant: "default"
    },
    {
      label: "Delete",
      icon: Trash2,
      onClick: handleDelete,
      variant: "destructive",
      disabled: !selectedItem
    }
  ]}
  compact={false}
/>
```

**Benefits**: Consistent action button styling, automatic icon sizing, disabled state handling, responsive behavior.

### Example 2: ItemSelector Pattern

**Good - Using ItemSelector**:
```tsx
import { ItemSelector } from "@/components/shared/ItemSelector"

<ItemSelector
  items={dataSources}
  selectedId={selectedDataSourceId}
  onSelect={setSelectedDataSourceId}
  getItemKey={(ds) => ds.id}
  getItemLabel={(ds) => ds.name}
  getItemMetadata={(ds) => ds.type}
  getItemIcon={(ds) => getDataSourceIcon(ds.type)}
  compact={false}
/>
```

**Benefits**: Consistent selection UI across data sources, insights, and dataframes. Handles metadata display, badges, icons uniformly.

### Example 3: EmptyState Pattern

**Good - Using EmptyState**:
```tsx
import { EmptyState } from "@/components/shared/EmptyState"

<EmptyState
  icon={Database}
  title="No data sources"
  description="Get started by adding your first data source"
  action={{
    label: "Add data source",
    onClick: handleCreate
  }}
/>
```

**Benefits**: Consistent empty state design, proper icon sizing, centered layout, clear call-to-action.

### Example 4: Stack Layout

**Good - Using Stack**:
```tsx
import { Stack } from "@/components/shared/Stack"

<Stack direction="vertical" spacing="lg">
  <h1>Page Title</h1>
  <Stack direction="horizontal" spacing="sm" align="center">
    <Icon className="h-4 w-4" />
    <span>Metadata</span>
  </Stack>
  <Card>Content</Card>
</Stack>
```

**Benefits**: Consistent spacing, clear intent, easier refactoring, type-safe props.

**Avoid - Custom flex divs**:
```tsx
<div className="flex flex-col gap-6">
  <h1>Page Title</h1>
  <div className="flex items-center gap-2">
    <Icon className="h-4 w-4" />
    <span>Metadata</span>
  </div>
  <Card>Content</Card>
</div>
```

**Why avoid**: Harder to maintain consistency, no type safety, more verbose, easy to diverge from design system.

## Component Creation Checklist

When creating a new shared component:

- [ ] **Clear purpose**: Component has a specific, semantic purpose (not just styling)
- [ ] **Used 3+ times**: Pattern appears in multiple features or will clearly be reused
- [ ] **TypeScript props**: Define clear props interface with JSDoc comments
- [ ] **Documentation**: Add JSDoc with description and usage example
- [ ] **Accessibility**: Include aria-labels, semantic HTML, keyboard navigation
- [ ] **Design tokens**: Use spacing/radius/icon/color tokens from design system
- [ ] **Composition**: Component composes well with other components
- [ ] **Testing**: Consider adding examples or test cases (when test infrastructure exists)
- [ ] **Update docs**: Add to this file's inventory and examples section

## Migration Patterns

### Migrating from Custom Divs to Stack

**Before**:
```tsx
<div className="flex flex-col gap-4">
  <ComponentA />
  <ComponentB />
</div>
```

**After**:
```tsx
<Stack direction="vertical" spacing="md">
  <ComponentA />
  <ComponentB />
</Stack>
```

### Migrating from Custom Empty States to EmptyState

**Before**:
```tsx
{items.length === 0 && (
  <div className="flex flex-col items-center justify-center p-8 text-center">
    <Database className="h-12 w-12 text-muted-foreground mb-4" />
    <h3 className="text-lg font-medium mb-2">No items</h3>
    <p className="text-sm text-muted-foreground mb-4">Add your first item</p>
    <Button onClick={handleAdd}>Add item</Button>
  </div>
)}
```

**After**:
```tsx
{items.length === 0 && (
  <EmptyState
    icon={Database}
    title="No items"
    description="Add your first item"
    action={{ label: "Add item", onClick: handleAdd }}
  />
)}
```

## Best Practices Summary

1. **Check before creating**: Always check `components/ui/` and `components/shared/` before writing custom JSX
2. **Compose, don't customize**: Combine existing components rather than creating variants
3. **Extract thoughtfully**: Wait until patterns clearly emerge (3+ uses) before extracting
4. **Name semantically**: Use purpose-based names (EmptyState, not CenteredMessage)
5. **Document thoroughly**: JSDoc for all shared components with usage examples
6. **Follow tokens**: Use design system spacing, radius, icons, colors consistently
7. **Prioritize accessibility**: Semantic HTML, aria-labels, keyboard navigation
8. **Keep it simple**: Don't over-engineer - the simplest solution that works is often best

---

**See Also**:
- `docs/architecture.md` - UI/UX Guidelines section (lines 239-307)
- `docs/specs/create-visualization-flow.md` - Example spec with UI layout
- `CLAUDE.md` - Development guidelines including UI component workflow
- `AGENTS.md` - Component decision tree for AI assistants
