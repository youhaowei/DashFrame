# DashFrame

DashFrame is a business intelligence playground focused on the DataFrame → chart journey. This MVP supports importing data from CSV files and Notion databases, as described in the [Data Engine architecture overview](docs/architecture.md), and provides a Next.js builder shell to iterate on visuals.

## Stack

- Next.js 16 (App Router) + React 19
- Tailwind CSS (via PostCSS) — shadcn components optional
- Turborepo for workspace orchestration
- Vega-Lite + Vega Embed for chart rendering
- Papaparse for CSV ingest, @notionhq/client for Notion database integration
- pnpm for dependency management

## Project Layout

```
apps/
  web/              # Next.js app (App Router)
packages/
  dataframe/        # DataFrame types and utilities
  csv/              # CSV ingest helpers → DataFrame
  notion/           # Notion database integration → DataFrame
  ui/               # Shared UI primitives/components
docs/
  architecture.md   # Architecture summary distilled from Notion
```

## Naming Conventions

- Use `DashFrame` for user-facing copy, branding, React components, and TypeScript types.
- Use `dash-frame` for package names, config identifiers, workspace scopes (e.g. `@dash-frame/dataframe`), directories, and persisted storage keys.
- Keep new packages under the `@dash-frame/*` scope so tooling and imports remain consistent.

### Packages

Each package is a TypeScript-first workspace member that exposes its source through `src/` and ships declarations from `dist/`. Every package follows the same `package.json` script contract:

- `build`: `pnpm exec tsc`
- `dev`: `pnpm exec tsc --watch`
- `lint`: `pnpm exec eslint src`
- `typecheck`: `pnpm exec tsc --noEmit`

Turbo treats these as common tasks (`pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm dev`). When you run `pnpm dev`, it launches `next dev` for the app and puts all library packages into TypeScript watch mode so changes flow through immediately.

Package responsibilities:

- `@dash-frame/dataframe`: DataFrame is a snapshot of the data in columns and rows, inspired by pandas, representing a table of data at a point in time. This package defines the DataFrame type and the functions to manipulate it.
- `@dash-frame/csv`: This package is for handling CSV files and converting them to a DataFrame.
- `@dash-frame/notion`: This package integrates with Notion databases via the official Notion API client, fetching database schemas and data, and converting them to a DataFrame.
- `@dash-frame/ui`: This package is for shared UI primitives and components.

## Getting Started

1. Install dependencies (requires Node 18+ and pnpm 9):

   ```bash
   pnpm install
   ```

2. Start the workspace in development mode (Next.js + package watch mode):

   ```bash
   pnpm dev
   ```

   Visit `http://localhost:3000/` — the homepage now hosts the CSV → DataFrame → chart experience.

   Need a single package? You can still target explicitly, e.g. `pnpm --filter @dash-frame/web dev` or `pnpm --filter @dash-frame/csv dev` for focused work.

3. Optional scripts:
   ```bash
   pnpm dev        # turbo dev (runs all dev targets)
   pnpm build      # turbo build
   pnpm format     # prettier --check with shared config
   pnpm format:write  # prettier --write with shared config
   pnpm check      # lint + typecheck + prettier check
   pnpm lint       # workspace linting (eslint 9)
   pnpm typecheck  # TypeScript checks for all packages
   pnpm test       # placeholder (no tests yet)
   ```

## Using Notion Integration

DashFrame supports importing data directly from Notion databases:

1. **Create a Notion Integration**:
   - Visit [notion.so/my-integrations](https://www.notion.so/my-integrations)
   - Click "+ New integration"
   - Give it a name (e.g., "DashFrame")
   - Copy the "Internal Integration Token" (starts with `secret_`)

2. **Share a Database with Your Integration**:
   - Open the Notion database you want to import
   - Click the "..." menu in the top right
   - Select "Connections" → "Connect to" → Find your integration

3. **Import Data in DashFrame**:
   - Click the "Notion DB" tab in the web app
   - Paste your API key (it's stored in browser localStorage)
   - Click "Connect" to see your databases
   - Select a database from the dropdown
   - Choose which properties (columns) to import
   - Click "Import Data" to load into DashFrame
   - Use the "Refresh" button to sync latest data from Notion

**Security Note**: Your Notion API key is stored in browser localStorage for convenience. For production use, consider implementing OAuth or server-side key management.

## Current Status

- ✅ Turborepo scaffolding, shared configs, and architecture doc
- ✅ CSV upload → DataFrame parsing → Vega-Lite preview (with axis selectors and persistence)
- ✅ Notion database integration with property selection and refresh capability
- ✅ Shared packages (`@dash-frame/dataframe`, `@dash-frame/csv`, `@dash-frame/notion`, `@dash-frame/ui`) seeded
- ✅ Vega chart rendered client-side via dynamic `VegaChart`

## Roadmap

- Add richer chart customisation (mark type, color palettes, formatting)
- Surface DataFrame metadata (fields, inferred types) in a sidebar inspector
- Extend documentation and introduce backend services (Deno/Convex) as needed
- Add automated tests (unit, Playwright) for the CSV upload flow

## Contributing

- Follow the shared ESLint + Prettier configs (`pnpm lint` / `pnpm format` when added)
- Keep architecture notes in `docs/`
- Prefer incremental commits per module (app, docs, packages)

Feel free to open issues or TODOs (`docs/dash.plan.md`) for upcoming tasks and refinements.
