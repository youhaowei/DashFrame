# UI Components Documentation

This document catalogs DashFrame's UI component inventory and usage patterns.

## Visualization Components

### Chart

Single entry point for all chart visualization rendering. Dispatches to registered ChartRenderers based on visualization type.

**Package:** `@dashframe/visualization`

**Props:**

| Prop                | Type                    | Description                                         |
| ------------------- | ----------------------- | --------------------------------------------------- |
| `tableName`         | `string`                | DuckDB table name (e.g., `df_${dataFrameId}`)       |
| `visualizationType` | `VisualizationType`     | Chart type: bar, line, area, scatter, table         |
| `encoding`          | `VisualizationEncoding` | Column mappings: { x, y, color, size }              |
| `className`         | `string?`               | Optional CSS class                                  |
| `width`             | `number \| "container"` | Width in pixels or responsive (default: container)  |
| `height`            | `number \| "container"` | Height in pixels or responsive (default: container) |
| `preview`           | `boolean`               | Enable preview mode (minimal chrome, no axes)       |
| `theme`             | `ChartTheme?`           | Optional theme configuration                        |
| `fallback`          | `React.ReactNode?`      | Fallback for unsupported types                      |

**Usage:**

```tsx
import { Chart } from "@dashframe/visualization";

// Basic usage
<Chart
  tableName="df_abc123_def456"
  visualizationType="bar"
  encoding={{ x: "category", y: "revenue" }}
/>

// Preview mode for thumbnails
<Chart
  tableName={tableName}
  visualizationType="line"
  encoding={{ x: "date", y: "value", color: "series" }}
  height={160}
  preview
/>

// Full-size with theme
<Chart
  tableName={tableName}
  visualizationType="scatter"
  encoding={{ x: "price", y: "quantity", size: "volume" }}
  width="container"
  height="container"
  theme={{ mode: "dark" }}
/>
```

**Prerequisites:**

1. Wrap your app with `VisualizationProvider`:

```tsx
import { VisualizationProvider } from "@dashframe/visualization";

function App() {
  const db = useDuckDB(); // Your DuckDB instance
  return <VisualizationProvider db={db}>{children}</VisualizationProvider>;
}
```

2. Register renderers before rendering charts:

```tsx
import {
  registerRenderer,
  createVgplotRenderer,
  useVisualization,
} from "@dashframe/visualization";

function VisualizationSetup({ children }) {
  const { api } = useVisualization();

  useEffect(() => {
    if (api) {
      registerRenderer(createVgplotRenderer(api));
    }
  }, [api]);

  return children;
}
```

**Data Flow:**

```
Chart
    │
    ├── visualizationType
    │         │
    ▼         ▼
  registry.get(type) ──► ChartRenderer
                             │
                             ▼
                    renderer.render(container, type, config)
                             │
                             ▼
                    DOM (SVG/Canvas)
```

**Notes:**

- Table type shows fallback - use VirtualTable component directly
- Container must have defined dimensions for `"container"` sizing
- Charts cleanup automatically on unmount or prop changes

---

## Component Inventory

### From @dashframe/ui

All UI components are exported from `@dashframe/ui`. Import as:

```tsx
import { Button, Card, Input, ... } from "@dashframe/ui";
```

#### Shadcn/ui Primitives (23 components)

| Component     | Purpose                              |
| ------------- | ------------------------------------ |
| Button        | Primary action element               |
| Card          | Content container with header/footer |
| Input         | Text input field                     |
| Select        | Dropdown selection                   |
| Dialog        | Modal dialogs                        |
| Dropdown Menu | Context menus                        |
| Tabs          | Tab navigation                       |
| Table         | Data tables                          |
| Form          | Form validation wrapper              |
| Checkbox      | Boolean selection                    |
| Radio Group   | Single selection from options        |
| Switch        | Toggle control                       |
| Slider        | Range selection                      |
| Textarea      | Multi-line text input                |
| Label         | Form labels                          |
| Separator     | Visual divider                       |
| Scroll Area   | Custom scrollbars                    |
| Skeleton      | Loading placeholders                 |
| Badge         | Status indicators                    |
| Avatar        | User avatars                         |
| Tooltip       | Hover information                    |
| Popover       | Click-triggered overlays             |
| Sheet         | Slide-out panels                     |

#### Custom Shared Components

| Component     | Purpose                    |
| ------------- | -------------------------- |
| ActionGroup   | Grouped action buttons     |
| ItemSelector  | List selection with search |
| Panel         | Collapsible sidebar panel  |
| Toggle        | Multi-option toggle button |
| Surface       | Elevated content container |
| VirtualTable  | Virtualized data table     |
| ConnectorIcon | Data source icons          |
| ChartIcon     | Visualization type icons   |

---

## Design Tokens

### Spacing

- `p-4` - Compact padding
- `p-6` - Standard padding
- `p-8` - Spacious padding

### Border Radius

Border radius uses CSS variables defined in `globals.css`:

```css
--radius: 0.625rem; /* 10px - base */
--radius-sm: calc(var(--radius) - 4px); /* 6px */
--radius-md: calc(var(--radius) - 2px); /* 8px */
--radius-lg: var(--radius); /* 10px */
--radius-xl: calc(var(--radius) + 4px); /* 14px */
```

**Component mapping:**

| Tailwind Class | CSS Variable  | Size | Usage                                                       |
| -------------- | ------------- | ---- | ----------------------------------------------------------- |
| `rounded-sm`   | `--radius-sm` | 6px  | Form inputs (Input, Select trigger, Checkbox), menu items   |
| `rounded-md`   | `--radius-md` | 8px  | Buttons, popovers, dropdowns, tooltips, navigation triggers |
| `rounded-lg`   | `--radius-lg` | 10px | Cards (ItemCard), dialogs, alerts, containers               |
| `rounded-xl`   | `--radius-xl` | 14px | Surface, large panels, badges                               |
| `rounded-full` | -             | 50%  | Switches, avatars, pills, circular icons                    |

**Visual hierarchy:**

```
rounded-sm (6px)  →  Form elements (sharp, action-oriented)
rounded-md (8px)  →  Interactive overlays (buttons, menus)
rounded-lg (10px) →  Content containers (cards, dialogs)
rounded-xl (14px) →  Surface containers (panels, badges)
rounded-full      →  Circular elements (toggles, avatars)
```

**Key principle:** Changing `--radius` in `globals.css` scales all components proportionally.

### Icon Sizing

- `h-4 w-4` - Inline with text
- `h-5 w-5` - Standalone icons
- `h-6 w-6` - Featured icons

### Typography

- No UPPERCASE text (except acronyms: CSV, API)
- Use sentence case everywhere

---

## Responsive Layout Patterns

### Prefer Intrinsic Sizing Over Media Queries

When building responsive layouts, **prefer CSS intrinsic sizing functions (`clamp()`, `min()`, `max()`, `minmax()`) over media query breakpoints**.

**Why:**

- Media queries respond to **viewport width**, but components often live inside panels, sidebars, or nested containers with unknown constraints
- Intrinsic sizing responds to **available container space**, making components resilient to any layout context
- Reduces CSS complexity - one rule handles all screen sizes

### Responsive Grid Pattern

For card grids that need to reflow based on available space:

```tsx
// ✅ Preferred: Intrinsic sizing with auto-fill
<div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-4">
  {items.map(item => <Card key={item.id} />)}
</div>

// ❌ Avoid: Breakpoint-based (doesn't account for container constraints)
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
  {items.map(item => <Card key={item.id} />)}
</div>
```

**How it works:**

- `auto-fill` - creates as many columns as fit
- `minmax(min(100%, 280px), 1fr)` - each column is at least 280px (or 100% on narrow containers), at most `1fr`
- The nested `min(100%, 280px)` prevents overflow when container is narrower than 280px

### Responsive Width with clamp()

For elements that need fluid width within bounds:

```tsx
// Width scales between 200px and 400px based on container
<div className="w-[clamp(200px,50%,400px)]">...</div>

// Font size scales between 14px and 18px
<p className="text-[clamp(0.875rem,2vw,1.125rem)]">...</p>
```

### When to Use Each Approach

| Scenario                                | Approach                            |
| --------------------------------------- | ----------------------------------- |
| Card grids, image galleries             | `auto-fill` + `minmax()`            |
| Fluid typography                        | `clamp()` with viewport units       |
| Element width bounds                    | `clamp(min, preferred, max)`        |
| Layout-level changes (sidebar collapse) | Media queries (`sm:`, `md:`, `lg:`) |
| Component visibility toggle             | Media queries                       |

**Rule of thumb:** Use intrinsic sizing for **sizing and spacing**, media queries for **layout structure changes**.

---

## Storybook

Browse all UI components interactively:

```bash
pnpm storybook
```

Opens at http://localhost:6006

---

## Adding New Components

1. Check if component exists in `@dashframe/ui`
2. If reusable (3+ uses), add to `packages/ui/src/components/`
3. Export from `packages/ui/src/index.ts`
4. Add JSDoc documentation
5. Create Storybook story
