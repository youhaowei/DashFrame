# DashFrame

DashFrame is a business intelligence playground focused on the DataFrame → chart journey. This MVP supports importing data from CSV files and Notion databases, as described in the [Data Engine architecture overview](docs/architecture.md), and provides a Next.js builder shell to iterate on visuals.

## Stack

- **Next.js 16** (App Router) + React 19
- **Convex** for backend persistence and real-time sync
- **Tailwind CSS v4** (via PostCSS) — shadcn components
- **Turborepo** for workspace orchestration
- **Vega-Lite + Vega Embed** for chart rendering
- **Papaparse** for CSV ingest, **@notionhq/client** for Notion
- **pnpm** for dependency management

## Project Layout

```
apps/
  web/              # Next.js app (App Router)
packages/
  dataframe/        # DataFrame types and utilities
  csv/              # CSV ingest helpers → DataFrame
  notion/           # Notion database integration → DataFrame
  ui/               # Shared UI primitives/components
convex/             # Backend (Convex functions + schema)
docs/
  architecture.md   # Architecture overview
```

## Naming Conventions

- Use `DashFrame` for user-facing copy, branding, React components, and TypeScript types.
- Use `dashframe` for package names, config identifiers, workspace scopes (e.g. `@dashframe/dataframe`), directories, and persisted storage keys.
- Keep new packages under the `@dashframe/*` scope so tooling and imports remain consistent.

### Packages

Each package is a TypeScript-first workspace member that exposes its source through `src/` and ships declarations from `dist/`. Every package follows the same `package.json` script contract:

- `build`: `pnpm exec tsc`
- `dev`: `pnpm exec tsc --watch`
- `lint`: `pnpm exec eslint src`
- `typecheck`: `pnpm exec tsc --noEmit`

Turbo treats these as common tasks (`pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm dev`). When you run `pnpm dev`, it launches `next dev` for the app and puts all library packages into TypeScript watch mode so changes flow through immediately.

Package responsibilities:

- `@dashframe/dataframe`: DataFrame is a snapshot of the data in columns and rows, inspired by pandas, representing a table of data at a point in time. This package defines the DataFrame type and the functions to manipulate it.
- `@dashframe/csv`: This package is for handling CSV files and converting them to a DataFrame.
- `@dashframe/notion`: This package integrates with Notion databases via the official Notion API client, fetching database schemas and data, and converting them to a DataFrame.
- `@dashframe/ui`: This package is for shared UI primitives and components.

## Getting Started

1. Install dependencies (requires Node 18+ and pnpm 9):

   ```bash
   pnpm install
   ```

2. Start the workspace in development mode:

   ```bash
   pnpm dev
   ```

   This single command starts:
   - **Convex backend** at `http://127.0.0.1:3210`
   - **Next.js web app** at `http://localhost:3000`
   - Auto-generates TypeScript types in `convex/_generated/`
   - Hot-reload for both frontend and backend

   Need a single package? Target explicitly: `pnpm --filter @dashframe/web dev`

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

- ✅ **Convex backend** with full entity persistence (DataSources, Insights, Visualizations)
- ✅ **Route-based architecture** - `/data-sources`, `/insights`, `/visualizations` pages
- ✅ CSV upload → DataFrame → Vega-Lite preview
- ✅ Notion database integration with property selection
- ✅ Shared packages (`@dashframe/dataframe`, `@dashframe/csv`, `@dashframe/notion`, `@dashframe/ui`)
- ✅ Real-time sync across tabs via Convex

## Roadmap

- Add richer chart customization (mark type, color palettes, formatting)
- Implement cross-source joins (CSV + Notion)
- Add automated tests (unit, Playwright)
- OAuth authentication (currently using anonymous auth)

## Contributing

- Follow the shared ESLint + Prettier configs (`pnpm lint` / `pnpm format` when added)
- Keep architecture notes in `docs/`
- Prefer incremental commits per module (app, docs, packages)

## License

DashFrame is **source-available**.

You are welcome to:

- use it locally,
- view the code,
- modify it,
- experiment,
- and build on top of it for personal or non-commercial purposes.

**Commercial use is not permitted** without an additional license.

This includes:

- hosting DashFrame as a service,
- selling dashboards or analytics built directly from the software,
- using DashFrame as part of a commercial SaaS or enterprise offering.

If you're interested in a commercial license or partnership, reach out at  
📧 **wei@youhao.me**

See the full license in the [`LICENSE`](./LICENSE) file.

### FAQ

**Can I run DashFrame locally for my personal projects or learning?**  
Yes — personal and non-commercial internal use is allowed.

**Can I use DashFrame at my company?**  
Yes, as long as you do **not** charge for it, resell it, or include it in a commercial product or hosted service.

**Can I host DashFrame or offer it as SaaS?**  
Not without a commercial license. The source-available license prohibits hosting or offering DashFrame as a service.

**Can I fork the project?**  
Yes, you may fork and modify the code, but the same non-commercial rules apply.

**Why not MIT or Apache?**  
The project is early-stage, and this license protects against early commercial clones while still allowing developers to use and explore the software.

**Will DashFrame ever switch to MIT/BSL/open-core/etc.?**  
Possibly! As the project grows, the licensing model may evolve to support wider community adoption and commercial hosting options.
