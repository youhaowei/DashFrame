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
  types/            # Shared DataFrame and domain typings
  ui/               # Shared UI utilities/components (placeholder)
docs/
  architecture.md   # Architecture summary distilled from Notion
```

## Getting Started

1. Install dependencies (requires Node 18+ and pnpm 9):

   ```bash
   pnpm install
   ```

2. Run the web app in development mode:

   ```bash
   pnpm --filter @dashframe/web dev
   ```

   Visit `http://localhost:3000/` — the homepage now hosts the CSV → DataFrame → chart experience.

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
- ✅ Shared packages (`@dashframe/types`, `@dashframe/ui`) seeded
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
