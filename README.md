# DashFrame

DashFrame is a business intelligence playground focused on the DataFrame → chart journey. This MVP supports importing data from CSV files and Notion databases, as described in the [Data Engine architecture overview](docs/architecture.md), and provides a Next.js builder shell to iterate on visuals.

## Stack

- **Next.js 16** (App Router) + React 19
- **Bun** for package management and runtime
- **Dexie (IndexedDB)** for client-side data persistence
- **DuckDB-WASM** for in-browser data processing
- **Tailwind CSS v4** (via PostCSS) — shadcn components
- **Turborepo** for workspace orchestration
- **Vega-Lite** for declarative chart rendering
- **Papaparse** for CSV ingest, **@notionhq/client** for Notion

## Project Layout

```
apps/
  web/              # Next.js app (App Router)
packages/
  types/            # Pure type contracts
  core/             # Backend selector
  core-dexie/       # Dexie/IndexedDB backend
  engine/           # Abstract engine interfaces
  engine-browser/   # DuckDB-WASM implementation
  connector-csv/    # CSV file connector
  connector-notion/ # Notion API connector
  visualization/    # Chart rendering system
  ui/               # Shared UI primitives/components
docs/
  architecture.md   # Architecture overview
```

## Naming Conventions

- Use `DashFrame` for user-facing copy, branding, React components, and TypeScript types.
- Use `dashframe` for package names, config identifiers, workspace scopes (e.g. `@dashframe/dataframe`), directories, and persisted storage keys.
- Keep new packages under the `@dashframe/*` scope so tooling and imports remain consistent.

### Packages

Each package is a TypeScript-first workspace member that exposes its source through `src/` and ships declarations from `dist/`. Every package follows the same `package.json` script contract:

- `build`: `tsc`
- `dev`: `tsc --watch`
- `lint`: `eslint src`
- `typecheck`: `tsc --noEmit`

Turbo treats these as common tasks (`bun run build`, `bun run lint`, `bun run typecheck`, `bun run dev`). When you run `bun run dev`, it launches `next dev` for the app and puts all library packages into TypeScript watch mode so changes flow through immediately.

Package responsibilities:

- `@dashframe/dataframe`: DataFrame is a snapshot of the data in columns and rows, inspired by pandas, representing a table of data at a point in time. This package defines the DataFrame type and the functions to manipulate it.
- `@dashframe/csv`: This package is for handling CSV files and converting them to a DataFrame.
- `@dashframe/notion`: This package integrates with Notion databases via the official Notion API client, fetching database schemas and data, and converting them to a DataFrame.
- `@dashframe/ui`: This package is for shared UI primitives and components.

## Getting Started

1. Install dependencies (requires Bun 1.x):

   ```bash
   bun install
   ```

2. Start the workspace in development mode:

   ```bash
   bun run dev
   ```

   This single command starts:
   - **Next.js web app** at `http://localhost:3000`
   - TypeScript watch mode for all packages
   - Hot-reload with instant feedback

   Need a single package? Target explicitly: `bun run --filter @dashframe/web dev`

3. Optional scripts:
   ```bash
   bun run dev        # turbo dev (runs all dev targets)
   bun run build      # turbo build
   bun run format     # prettier --check with shared config
   bun run format:write  # prettier --write with shared config
   bun run check      # lint + typecheck + prettier check
   bun run lint       # workspace linting (eslint 9)
   bun run typecheck  # TypeScript checks for all packages
   bun run test       # run all tests
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

- ✅ **Client-side persistence** with Dexie (IndexedDB)
- ✅ **In-browser query engine** with DuckDB-WASM
- ✅ **Route-based architecture** - `/data-sources`, `/insights`, `/visualizations` pages
- ✅ CSV upload → DataFrame → Vega-Lite charts
- ✅ Notion database integration with property selection
- ✅ Pluggable backend architecture for custom implementations
- ✅ Real-time reactive updates with useLiveQuery

## Roadmap

- Add richer chart customization (mark type, color palettes, formatting)
- Implement cross-source joins (CSV + Notion)
- Add automated tests (unit, Playwright)
- OAuth authentication (currently using anonymous auth)

## Contributing

- Follow the shared ESLint + Prettier configs (`bun run lint` / `bun run format`)
- Keep architecture notes in `docs/`
- Prefer incremental commits per module (app, docs, packages)

## License

DashFrame is MIT licensed.

You are welcome to:

- use it locally or in production,
- view and modify the code,
- fork and redistribute it,
- and build commercial or open-source products with it.

The only requirement is to include the copyright notice and MIT license
in copies or substantial portions of the software. See the full text in
the [`LICENSE`](./LICENSE) file.

### FAQ

**Can I run DashFrame locally for my personal projects or learning?**  
Yes — the MIT License permits personal and educational use.

**Can I use DashFrame at my company or in commercial products?**  
Yes — commercial use is allowed under the MIT License.

**Can I host DashFrame or offer it as SaaS?**  
Yes. You can host, resell, or integrate it, provided you keep the MIT license and copyright notice and comply with any third-party API terms.

**Can I fork the project?**  
Yes. MIT allows forking and redistribution as long as the license and copyright notice remain.

**Do I need to attribute DashFrame?**  
MIT requires preserving the copyright notice and license. Additional attribution is appreciated but not required.
