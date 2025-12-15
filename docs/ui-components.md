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

- `rounded-2xl` - Main cards
- `rounded-xl` - Nested elements
- `rounded-full` - Badges, avatars

### Icon Sizing

- `h-4 w-4` - Inline with text
- `h-5 w-5` - Standalone icons
- `h-6 w-6` - Featured icons

### Typography

- No UPPERCASE text (except acronyms: CSV, API)
- Use sentence case everywhere

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
