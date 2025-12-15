# @dashframe/visualization

Pluggable chart rendering system for DashFrame. Provides a unified interface for rendering various chart types using DuckDB as the query engine.

## Installation

```bash
pnpm add @dashframe/visualization
```

## Quick Start

```tsx
import {
  VisualizationProvider,
  Chart,
  registerRenderer,
  createVgplotRenderer,
  useVisualization,
} from "@dashframe/visualization";

// 1. Wrap your app with VisualizationProvider
function App() {
  const db = useDuckDB(); // Your DuckDB-WASM instance

  return (
    <VisualizationProvider db={db}>
      <VisualizationSetup>
        <MyCharts />
      </VisualizationSetup>
    </VisualizationProvider>
  );
}

// 2. Register renderers
function VisualizationSetup({ children }) {
  const { api } = useVisualization();

  useEffect(() => {
    if (api) {
      registerRenderer(createVgplotRenderer(api));
    }
  }, [api]);

  return children;
}

// 3. Render charts
function MyCharts() {
  return (
    <Chart
      tableName="my_table"
      visualizationType="bar"
      encoding={{ x: "category", y: "value" }}
    />
  );
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Chart                          │
│  • Receives: tableName, visualizationType, encoding      │
│  • Delegates to appropriate renderer via registry        │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│               ChartRenderer Interface                    │
│  render(container, type, config) → cleanup()            │
└─────────────────────────────────────────────────────────┘
         │                    │                    │
   ┌─────┴─────┐       ┌─────┴─────┐       ┌─────┴─────┐
   │  Vgplot   │       │    D3     │       │  Custom   │
   │  Renderer │       │ Renderer  │       │ Renderer  │
   └───────────┘       └───────────┘       └───────────┘
```

## API Reference

### VisualizationProvider

Wraps your application to provide the Mosaic coordinator connected to DuckDB.

```tsx
<VisualizationProvider db={duckDbInstance}>{children}</VisualizationProvider>
```

### useVisualization

Hook to access the vgplot API context.

```tsx
const { api, isReady } = useVisualization();
```

### Chart

Single entry point for rendering all chart types.

| Prop                | Type                    | Default       | Description               |
| ------------------- | ----------------------- | ------------- | ------------------------- |
| `tableName`         | `string`                | required      | DuckDB table name         |
| `visualizationType` | `VisualizationType`     | required      | Chart type                |
| `encoding`          | `VisualizationEncoding` | required      | Column mappings           |
| `width`             | `number \| "container"` | `"container"` | Chart width               |
| `height`            | `number \| "container"` | `"container"` | Chart height              |
| `preview`           | `boolean`               | `false`       | Minimal chrome for thumbs |
| `theme`             | `ChartTheme`            | `undefined`   | Theme configuration       |
| `fallback`          | `ReactNode`             | `undefined`   | Unsupported type fallback |

### Registry Functions

```tsx
// Register a renderer
registerRenderer(renderer: ChartRenderer): void

// Get renderer for a type
getRenderer(type: VisualizationType): ChartRenderer | undefined

// Check if type is supported
hasRenderer(type: VisualizationType): boolean

// List all supported types
getSupportedTypes(): VisualizationType[]

// Clear all renderers
clearRenderers(): void
```

### createVgplotRenderer

Factory function to create the vgplot-based renderer for standard chart types.

```tsx
const renderer = createVgplotRenderer(api);
// Supports: bar, line, area, scatter
```

## Adding Custom Renderers

Implement the `ChartRenderer` interface from `@dashframe/core`:

```tsx
import type { ChartRenderer, ChartConfig } from "@dashframe/core";
import { registerRenderer } from "@dashframe/visualization";

const myRenderer: ChartRenderer = {
  supportedTypes: ["sankey", "treemap"],

  render(container, type, config) {
    // Your rendering logic
    const { tableName, encoding, width, height } = config;

    // ... render to container ...

    // Return cleanup function
    return () => {
      container.innerHTML = "";
    };
  },
};

registerRenderer(myRenderer);
```

## Supported Chart Types

### Built-in (VgplotRenderer)

| Type      | vgplot Mark | Description        |
| --------- | ----------- | ------------------ |
| `bar`     | `barY()`    | Vertical bar chart |
| `line`    | `lineY()`   | Line chart         |
| `area`    | `areaY()`   | Area chart         |
| `scatter` | `dot()`     | Scatter plot       |

### Special Handling

| Type    | Handling                         |
| ------- | -------------------------------- |
| `table` | Shows fallback, use VirtualTable |

## Dependencies

- `@dashframe/core` - Types and interfaces
- `@uwdata/vgplot` - Mosaic visualization library
- `@duckdb/duckdb-wasm` - DuckDB WebAssembly
- `react` - React 18+

## Design Decisions

- **Encoding-driven**: Charts built from encoding at render time, not stored specs
- **Query pushdown**: Aggregations computed in DuckDB, not JavaScript
- **Pluggable**: New chart types only require implementing ChartRenderer
- **SSR-safe**: Uses dynamic imports for client-only rendering
