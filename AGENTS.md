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

3. **Review [`docs/architecture.md`](./docs/architecture.md)** for system design:
   - Vision and domain model
   - State management architecture
   - Data flow patterns
   - UI/UX guidelines

## Essential Quick Reference

### Core Technologies

- **Monorepo**: pnpm + Turborepo (`apps/*`, `packages/*`)
- **Framework**: Next.js 16 (App Router) + React 19
- **Styling**: Tailwind CSS v4 + shadcn/ui components
- **State**: Zustand + Immer with localStorage persistence
- **Types**: TypeScript (strict mode)

### Key Commands

```bash
pnpm check      # Run lint + typecheck + format (before committing)
pnpm dev        # Run dev server + TypeScript watch mode
pnpm build      # Build all packages and apps
```

**⚠️ NEVER run `pnpm build` or `pnpm dev` unless explicitly requested.**

### Naming Conventions

- **User-facing**: `DashFrame` (PascalCase)
- **Packages**: `@dashframe/*` (lowercase scope)
- **Storage keys**: `dashframe:*` (lowercase prefix)

### Development Workflow

1. **Spec-first**: Create `docs/specs/<feature>.md` before implementing
2. **Component-first**: Check `components/ui/` and `components/shared/` before writing custom JSX
3. **Check before committing**: Run `pnpm check`

## UI Component Quick Decision Tree

```
Need UI?
  ↓
1. Check components/ui/ (shadcn/ui) → Use if available
2. Check components/shared/ (custom) → Use if pattern matches
3. Pattern used 3+ times? → Extract to shared/
4. Otherwise → Create feature-specific component
```

**See [`docs/ui-components.md`](./docs/ui-components.md) for complete component documentation.**

---

**For everything else, see [`CLAUDE.md`](./CLAUDE.md).**
