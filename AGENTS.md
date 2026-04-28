# Agent Playbook

**For comprehensive development guidance, see [`CLAUDE.md`](./CLAUDE.md).**

This file serves as a brief entry point for automated agents and AI assistants working in this repository. All detailed guidance is maintained in `CLAUDE.md` to avoid duplication.

## Quick Start

1. **Read [`CLAUDE.md`](./CLAUDE.md)** - Complete development guidance including:
   - Essential commands and workspace setup
   - Core architecture and design principles
   - UI component guidelines and design tokens
   - Development best practices and workflows

2. **Check [`docs/ui-components.md`](./docs/ui-components.md)** before implementing UI changes:
   - Component inventory (shadcn/ui + custom shared components)
   - Design system tokens and patterns
   - Decision framework for component reuse
   - Real examples from the codebase

3. **Use the Notion v0.2 specs for current architecture.** The legacy web/DuckDB-WASM/Dexie architecture snapshot was moved to Notion as [Deprecated — DashFrame Web Architecture](https://www.notion.so/34ed48ccaf5481a38fe9c1b39ac362ec). Treat v0.1 code as the product baseline to preserve/revive, not as the current architecture spec.

## Essential Quick Reference

### Core Technologies

- **Monorepo**: Bun + Turborepo (`apps/*`, `packages/*`)
- **Apps**: v0.1 Next.js web app plus v0.2 Electron + Vite renderer shell
- **Styling**: Tailwind CSS v4 + stdui components
- **State**: Zustand + Immer; v0.1 Dexie path plus v0.2 server-core artifact DB
- **Types**: TypeScript (strict mode)

### Key Commands

```bash
bun check      # Run lint + typecheck + format (before committing)
bun dev        # Run repo dev tasks; check for existing sessions first
bun dev:desktop # Run desktop dev orchestration intentionally
bun build      # Build all packages and apps
```

**Dev server discipline:** Do not blindly start long-running dev/watch commands. First check whether a dev server or Electron session is already running, avoid clobbering the user's session, and use an alternate port/session when needed. Scoped validation/build commands are okay when relevant to the task.

### Naming Conventions

- **User-facing**: `DashFrame` (PascalCase)
- **Packages**: `@dashframe/*` (lowercase scope)
- **Storage keys**: `dashframe:*` (lowercase prefix)

### Development Workflow

1. **Spec-first**: Update/create the relevant Notion spec before implementing user-facing v0.2 work
2. **Preserve v0.1**: Do not remove working web, DuckDB-WASM, connector, visualization, or dashboard markdown behavior unless explicitly scoped
3. **Component-first**: Check stdui and `@dashframe/ui` before writing custom JSX
4. **Check before committing**: Run `bun check`

## UI Component Quick Decision Tree

```
Need UI?
  ↓
1. Check `@stdui/react` → Use if available
2. Check `@dashframe/ui` → Use if the pattern is DashFrame-specific
3. Pattern used 3+ times? → Extract to stdui or `@dashframe/ui`
4. Otherwise → Create feature-specific component
```

**See [`docs/ui-components.md`](./docs/ui-components.md) for complete component documentation.**

---

**For everything else, see [`CLAUDE.md`](./CLAUDE.md).**
