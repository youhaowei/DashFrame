# UI Components

This document provides comprehensive guidance on UI components in DashFrame, covering our design system, component inventory, and principles for creating reusable components.

## Package Structure

All UI components are centralized in the `@dashframe/ui` package (`packages/ui/`):

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

**Importing components**: All components are exported from the package root:

```typescript
import { Button, Card, Panel, Toggle, cn } from "@dashframe/ui";
import { Refresh } from "@dashframe/ui/icons";
```

**Icon imports**: Always import icons from `@dashframe/ui/icons` (never from the package root). A lint rule (`no-restricted-imports`) in `apps/web` enforces this.

**Storybook**: Run `pnpm storybook` to browse components interactively at http://localhost:6006

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

### shadcn/ui Components (`@dashframe/ui` primitives)

**Standard UI primitives built on Radix UI.** Located in `packages/ui/src/primitives/`.

- **Actions**: `button`, `dropdown-menu`
- **Forms**: `checkbox`, `field`, `input`, `label`, `select`, `switch`, `multi-select`
- **Data Display**: `badge`, `table`, `tabs`, `separator`, `scroll-area`
- **Feedback**: `alert`, `sonner` (toast notifications), `tooltip`
- **Layout**: `dialog`, `collapsible`, `navigation-menu`, `surface`

**When to use**: These are your building blocks. Use them for all standard UI patterns (buttons, inputs, cards, modals, etc.). They provide consistent styling, accessibility, and behavior out of the box.

#### Surface Component

**`Surface`** - Primitive component for standardized elevation and visual depth.

- **Purpose**: Provides foundational system for creating UI layers with consistent elevation effects
- **Location**: `packages/ui/src/primitives/surface.tsx`
- **Import**: `import { Surface } from "@dashframe/ui";`
- **Use for**: Backgrounds, containers, and any element needing standardized depth or visual hierarchy

**Elevation variants**:

- `plain` - Minimal flat surface with border only, no shadow
- `raised` - Standard elevated surface with subtle shadow (default)
- `floating` - Prominent elevation with backdrop blur and stronger shadow
- `inset` - Sunken appearance with inset shadow for recessed areas

**Props**:

- `elevation?: "plain" | "raised" | "floating" | "inset"` - Visual depth variant (default: `"raised"`)
- `interactive?: boolean` - Adds hover states for clickable surfaces (default: `false`)
- Standard div props + `className` for spacing/customization

**Examples**:

```tsx
// Standard card surface
<Surface elevation="raised" className="p-6">
  <h2>Content</h2>
</Surface>

// Elevated panel with backdrop blur
<Surface elevation="floating" className="p-8">
  <nav>Navigation</nav>
</Surface>

// Sunken empty state area
<Surface elevation="inset" className="p-8 text-center">
  <p>No items found</p>
</Surface>

// Interactive clickable surface
<Surface elevation="raised" interactive className="p-4 cursor-pointer">
  <button>Click me</button>
</Surface>
```

### Custom Shared Components (`@dashframe/ui` components)

**DashFrame-specific reusable patterns.** Located in `packages/ui/src/components/`.

- **`Card`** - Enhanced content grouping component with standardized elevation
  - Use for: Structured content layout with headers, titles, descriptions, and footers
  - Built on: Uses `Surface` primitive internally for consistent elevation
  - Subcomponents: `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`, `CardAction`
  - Props: Same as `Surface` (`elevation`, `interactive`) plus standard div props
  - Example: Content cards, feature panels, data displays

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

- **`Panel`** - Reusable panel component with fixed header/footer and scrollable content
  - Use for: Any panel layout (side panels, detail panels, main content areas)
  - Built on: Uses `Surface` primitive internally for consistent elevation
  - Features: Optional header/footer, automatic scrolling, forward ref support
  - Subcomponent: `PanelSection` for section dividers within panels
  - Props: `elevation` (default: "raised"), `header`, `footer`, `children`, `className`
  - Example: Settings panels, control panels, detail views

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

- **From shadcn/ui**: `surface`, `separator`, `scroll-area`
- **Custom shared**: `Card`, `Stack`, `Container`, `Panel`

**Pattern**: Use Surface for generic elevation effects, Card for structured content with headers/footers, Panel for full-height layouts with headers/footers, Stack for vertical/horizontal layouts, Container for max-width constraints.

**Surface vs Card vs Panel decision tree**:

- Use **Surface** for: Generic backgrounds, containers, panels without structured content
- Use **Card** for: Content grouping with headers, titles, descriptions, actions (uses Surface internally)
- Use **Panel** for: Full-height layouts with fixed header/footer and scrollable content (uses Surface internally)

```tsx
// Good - Using layout components with Surface and Card
<Container>
  <Stack direction="vertical" spacing="lg">
    {/* Use Card for structured content */}
    <Card elevation="raised">
      <CardHeader>
        <CardTitle>Data Sources</CardTitle>
        <CardDescription>Manage your connected data sources</CardDescription>
      </CardHeader>
      <CardContent>
        <p>Content here</p>
      </CardContent>
    </Card>

    {/* Use Surface for generic containers */}
    <Surface elevation="inset" className="p-6 text-center">
      <p className="text-muted-foreground">No data available</p>
    </Surface>
  </Stack>
</Container>

// Avoid - Custom div wrappers
<div className="max-w-7xl mx-auto px-6">
  <div className="flex flex-col gap-6">
    <div className="rounded-2xl border p-6 shadow-sm bg-card">
      <div className="px-6">
        <h2>Data Sources</h2>
        <p>Manage your connected data sources</p>
      </div>
      <div className="px-6">
        <p>Content here</p>
      </div>
    </div>
    <div className="rounded-2xl border border-dashed p-6 text-center bg-background/40 shadow-inner">
      <p className="text-muted-foreground">No data available</p>
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

### Icons

**Import from centralized icon system**: All icons are exported from `@dashframe/ui/icons` with semantic names.

```typescript
import { Chart, Delete, Edit, Close } from "@dashframe/ui/icons";
```

**Semantic naming**: Icons are named by their purpose or action, not their visual appearance:
- Actions: `Edit`, `Delete`, `Close`, `Refresh`, `Search`, `Copy`
- Navigation: `ArrowLeft`, `ChevronDown`, `Menu`, `Dashboard`
- Data: `Database`, `File`, `Spreadsheet`, `Chart`, `Table`
- Status: `Loader`, `Check`, `Alert`, `Info`, `Pending`

**Icon sizing**:
- **Inline with text**: `h-4 w-4`
- **Standalone**: `h-5 w-5`
- **Section headers**: `h-6 w-6`
- **Empty states**: `h-12 w-12` or larger

**Consistency**: All icons come from Lucide (via react-icons). Use the centralized exports to ensure consistency. ESLint enforces this via the `no-restricted-imports` rule.

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
import { ActionGroup } from "@/components/shared/ActionGroup";

<ActionGroup
  actions={[
    {
      label: "Create",
      icon: Plus,
      onClick: handleCreate,
      variant: "default",
    },
    {
      label: "Delete",
      icon: Delete,
      onClick: handleDelete,
      variant: "destructive",
      disabled: !selectedItem,
    },
  ]}
  compact={false}
/>;
```

**Benefits**: Consistent action button styling, automatic icon sizing, disabled state handling, responsive behavior.

### Example 2: ItemSelector Pattern

**Good - Using ItemSelector**:

```tsx
import { ItemSelector } from "@/components/shared/ItemSelector";

<ItemSelector
  items={dataSources}
  selectedId={selectedDataSourceId}
  onSelect={setSelectedDataSourceId}
  getItemKey={(ds) => ds.id}
  getItemLabel={(ds) => ds.name}
  getItemMetadata={(ds) => ds.type}
  getItemIcon={(ds) => getDataSourceIcon(ds.type)}
  compact={false}
/>;
```

**Benefits**: Consistent selection UI across data sources, insights, and dataframes. Handles metadata display, badges, icons uniformly.

### Example 3: EmptyState Pattern

**Good - Using EmptyState**:

```tsx
import { EmptyState } from "@/components/shared/EmptyState";

<EmptyState
  icon={Database}
  title="No data sources"
  description="Get started by adding your first data source"
  action={{
    label: "Add data source",
    onClick: handleCreate,
  }}
/>;
```

**Benefits**: Consistent empty state design, proper icon sizing, centered layout, clear call-to-action.

### Example 4: Stack Layout

**Good - Using Stack**:

```tsx
import { Stack } from "@/components/shared/Stack";

<Stack direction="vertical" spacing="lg">
  <h1>Page Title</h1>
  <Stack direction="horizontal" spacing="sm" align="center">
    <Icon className="h-4 w-4" />
    <span>Metadata</span>
  </Stack>
  <Card>Content</Card>
</Stack>;
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

### Example 5: Panel Component

**Good - Using Panel**:

```tsx
import { Panel, PanelSection } from "@/components/shared/Panel";

// Standard panel with header and footer
<Panel
  header={
    <div className="flex items-center justify-between">
      <h2 className="text-xl font-semibold">Settings</h2>
      <Button>Save</Button>
    </div>
  }
  footer={
    <div className="flex justify-end gap-2">
      <Button variant="outline">Cancel</Button>
      <Button>Apply</Button>
    </div>
  }
>
  <PanelSection title="General" description="Basic configuration options">
    <div>Settings content here</div>
  </PanelSection>

  <PanelSection title="Advanced">
    <div>Advanced options</div>
  </PanelSection>
</Panel>;

// Panel with forward ref for ResizeObserver
const panelRef = useRef<HTMLDivElement>(null);
<Panel ref={panelRef} header={<h2>Resizable Panel</h2>}>
  <div>Content that needs resize tracking</div>
</Panel>;
```

**Benefits**: Fixed header/footer, automatic scrolling, consistent elevation via Surface, section dividers with PanelSection, forward ref support.

**Avoid - Manual panel divs**:

```tsx
<div className="bg-card flex h-full flex-col overflow-hidden rounded-2xl border shadow-sm">
  <div className="border-b p-6">
    <div className="flex items-center justify-between">
      <h2 className="text-xl font-semibold">Settings</h2>
      <Button>Save</Button>
    </div>
  </div>

  <div className="flex-1 overflow-y-auto p-6">
    <div className="border-b p-6">
      <h3 className="font-semibold">General</h3>
      <p className="text-muted-foreground text-sm">
        Basic configuration options
      </p>
      <div>Settings content here</div>
    </div>

    <div className="p-6">
      <h3 className="font-semibold">Advanced</h3>
      <div>Advanced options</div>
    </div>
  </div>

  <div className="border-t p-6">
    <div className="flex justify-end gap-2">
      <Button variant="outline">Cancel</Button>
      <Button>Apply</Button>
    </div>
  </div>
</div>
```

**Why avoid**: Manual border/padding management, inconsistent elevation, repetitive section structure, no ref forwarding, hard to maintain.

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
{
  items.length === 0 && (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <Database className="text-muted-foreground mb-4 h-12 w-12" />
      <h3 className="mb-2 text-lg font-medium">No items</h3>
      <p className="text-muted-foreground mb-4 text-sm">Add your first item</p>
      <Button onClick={handleAdd}>Add item</Button>
    </div>
  );
}
```

**After**:

```tsx
{
  items.length === 0 && (
    <EmptyState
      icon={Database}
      title="No items"
      description="Add your first item"
      action={{ label: "Add item", onClick: handleAdd }}
    />
  );
}
```

### Migrating from Manual Card Divs to Surface

**Before - Manual raised surface**:

```tsx
<div className="border-border/60 bg-card/80 rounded-2xl border p-6 shadow-sm">
  <p className="text-muted-foreground text-sm">Content here</p>
</div>
```

**After - Surface component**:

```tsx
<Surface elevation="raised" className="p-6">
  <p className="text-muted-foreground text-sm">Content here</p>
</Surface>
```

**Before - Manual inset surface (empty state)**:

```tsx
<div className="border-border/70 bg-background/40 w-full rounded-2xl border border-dashed p-8 text-center shadow-inner shadow-black/5">
  <p className="text-foreground text-base font-medium">
    No data source selected
  </p>
  <p className="text-muted-foreground mt-2 text-sm">
    Select a data source to view its data.
  </p>
</div>
```

**After - Surface with inset elevation**:

```tsx
<Surface elevation="inset" className="w-full p-8 text-center">
  <p className="text-foreground text-base font-medium">
    No data source selected
  </p>
  <p className="text-muted-foreground mt-2 text-sm">
    Select a data source to view its data.
  </p>
</Surface>
```

**Benefits**: Standardized elevation system, consistent shadow/border/background patterns, simplified className props, single source of truth for surface styling.

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
