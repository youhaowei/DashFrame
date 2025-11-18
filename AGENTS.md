# Agent Playbook

Guidance for automation and future contributors working in this repository.

## Quick Facts

- Monorepo managed with `pnpm` and Turborepo; packages live under `apps/*` and `packages/*`.
- Primary app sits in `apps/web` (Next.js 16 + React 19).
- TypeScript is ubiquitous; linting flows through ESLint 9 + shared config.

## Naming Conventions

- Brand-facing references and code identifiers (components, types) use `DashFrame`.
- Package scopes, directories, config keys, and persisted storage entries use kebab-case `dash-frame`, e.g. `@dash-frame/dataframe`.
- When adding new workspace members, prefer the `@dash-frame/*` scope and update `pnpm-workspace.yaml` if layout changes.

## Commands

- Install dependencies: `pnpm install`
- Run dev mode: `pnpm dev`
- Check formatting: `pnpm format`
- Apply formatting fixes: `pnpm format:write`
- Run full static checks (lint+types+format): `pnpm check`
- Lint all packages: `pnpm lint`
- Type-check workspace: `pnpm typecheck`
- Build everything: `pnpm build`

## Expectations

- **Spec-First Development**: Before implementing new features or significant UX changes, create a feature spec in `docs/specs/<feature-name>.md`. Document user flows, UI layouts, decision rationale, and error handling. Reference `docs/specs/create-visualization-flow.md` as an example.
- Favor incremental, targeted changes; avoid rewriting unrelated files.
- Keep documentation synchronized—update README/docs whenever conventions shift.
- Prefer `rg` for search, `pnpm` scripts over invoking underlying binaries directly, and stay consistent with existing formatting (Prettier config applies).
