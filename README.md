# DashFrame

[![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/youhaowei/DashFrame)](https://coderabbit.ai)

DashFrame is a local-first BI tool. The current codebase preserves the working v0.1 web app while v0.2 desktop architecture is revived on top of it with Electron, a Vite renderer shell, PGLite/Drizzle project artifacts, and WyStack transport/reactivity primitives.

Current architecture and product scope live in Notion and are linked from [`CLAUDE.md`](./CLAUDE.md). The old web/DuckDB-WASM/Dexie architecture document was moved to Notion as [Deprecated - DashFrame Web Architecture](https://www.notion.so/34ed48ccaf5481a38fe9c1b39ac362ec), but the v0.1 implementation remains the baseline to preserve.

## Stack

- **Runtime/package manager**: Bun
- **Web app**: Next.js 16 + React 19
- **Desktop shell**: Electron main/preload
- **Renderer shell**: React 19 + Vite + TanStack Router
- **Analytics**: DuckDB-WASM in web; native DuckDB path planned for Electron
- **Artifact storage**: v0.1 Dexie plus v0.2 PGLite + DashFrame-owned Drizzle schemas
- **Transport/reactivity**: WyStack server substrate, without a `wystack-db` wrapper
- **Styling/UI**: Tailwind CSS v4 + stdui
- **Workspace**: Turborepo

## Project Layout

```text
apps/
  web/           # v0.1 Next.js app to preserve/revive
  desktop/       # v0.2 Electron main process
  renderer/      # v0.2 Vite + React renderer shell
packages/
  engine-browser/# DuckDB-WASM browser engine
  visualization/ # Chart rendering
  server-core/   # v0.2 PGLite/Drizzle project DB
  eslint-config/ # Shared ESLint config
libs/
  stdui/         # Design system submodule
  wystack/       # WyStack submodule
docs/
  ui-components.md
  specs/         # Historical/local specs; new v0.2 specs live in Notion
```

## Commands

```bash
bun install
bun check
bun run test
bun dev:desktop
```

Dev server discipline: do not blindly start long-running dev/watch commands. First check whether a dev server or Electron session is already running, avoid clobbering the user's session, and use an alternate port/session when needed.

## Documentation

- [`CLAUDE.md`](./CLAUDE.md) — current local agent/development guidance
- [`AGENTS.md`](./AGENTS.md) — short agent entry point
- [`docs/ui-components.md`](./docs/ui-components.md) — UI component inventory
- [PRD - DashFrame v0.2](https://www.notion.so/342d48ccaf5481589e21e8678cd6f8ce)
- [Spec - DashFrame v0.2 Architecture Overview](https://www.notion.so/342d48ccaf5481408324cc4d4c5b4f17)

## License

MIT.
