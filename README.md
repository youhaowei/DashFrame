# DashFrame

DashFrame is a business intelligence playground focused on the DataFrame → chart journey. This MVP validates the CSV upload flow described in the [Data Engine architecture overview](docs/architecture.md) and provides a Next.js builder shell to iterate on visuals.

## Stack

- Next.js 16 (App Router) + React 19
- Tailwind CSS (via PostCSS) — shadcn components optional
- Turborepo for workspace orchestration
- Vega-Lite + Vega Embed for chart rendering, Papaparse for CSV ingest
- pnpm for dependency management

## Project Layout

```
apps/
  web/              # Next.js app (App Router)
packages/
  dataframe/        # DataFrame types and utilities
  csv/              # CSV ingest helpers → DataFrame
  ui/               # Shared UI primitives/components
docs/
  architecture.md   # Architecture summary distilled from Notion
```

### Packages

Each package is a TypeScript-first workspace member that exposes its source through `src/` and ships declarations from `dist/`. Every package follows the same `package.json` script contract:

- `build`: `pnpm exec tsc`
- `dev`: `pnpm exec tsc --watch`
- `lint`: `pnpm exec eslint src`
- `typecheck`: `pnpm exec tsc --noEmit`

Turbo treats these as common tasks (`pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm dev`). When you run `pnpm dev`, it launches `next dev` for the app and puts all library packages into TypeScript watch mode so changes flow through immediately.

Package responsibilities:

- `@dashframe/dataframe`: DataFrame is a snapshot of the data in columns and rows, inspired by pandas, representing a table of data at a point in time. This packages defines the DataFrame type and the functions to manipulate it.
- `@dashframe/csv`: This package is for handling the csv file, and converting it to a DataFrame.
- `@dashframe/ui`: This package is for shared UI primitives and components.

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

   Need a single package? You can still target explicitly, e.g. `pnpm --filter @dashframe/web dev` or `pnpm --filter @dashframe/csv dev` for focused work.

3. Optional scripts:
   ```bash
   pnpm dev        # turbo dev (runs all dev targets)
   pnpm build      # turbo build
   pnpm lint       # workspace linting (eslint 9)
   pnpm typecheck  # TypeScript checks for all packages
   pnpm test       # placeholder (no tests yet)
   ```

## Current Status

- ✅ Turborepo scaffolding, shared configs, and architecture doc
- ✅ CSV upload → DataFrame parsing → Vega-Lite preview (with axis selectors and persistence)
- ✅ Shared packages (`@dashframe/dataframe`, `@dashframe/csv`, `@dashframe/ui`) seeded
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
