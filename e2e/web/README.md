# DashFrame web E2E tests

The Playwright specs in `tests/` cover CSV and JSON imports, chart editing,
compound insight edits, dashboards, draft review, and error handling. Sample data files
live in `fixtures/`; shared browser and API helpers live in `lib/`.

From the repository root, install dependencies, build the vendored packages,
and provision the pinned local Convex binary:

```sh
bun install --frozen-lockfile
bun run build:wystack
bun run --filter @dashframe/convex-local provision
cd e2e/web
bun playwright install chromium
bun run test:e2e:ci
```

Playwright builds the web app and starts a dedicated host and preview server.
Each run creates a unique temporary directory with separate project and
host-credential directories. Tests run serially, clear native metadata and
host-owned data before each test, and use fresh browser contexts. Arrow files
belong to the host; IndexedDB is not the data store under test.

The fixtures authenticate through the host, discover its Convex URL, and inject
that runtime before the renderer starts. Draft fixtures call native Convex
queries and mutations; host-only operations use `/api/host/*`.

Run a specific workflow or inspect the suite:

```sh
bun run test:e2e:ci tests/csv-to-chart.spec.ts
bun run test:e2e:ci tests/draft-review.spec.ts
bun run test:e2e --list
bun run test:headed
bun run test:debug
```

Failures retain screenshots and videos in `test-results/`; retries also capture
traces. Use `bun run test:html` for the HTML report. Temporary project files stay
available for diagnosis after the server processes stop.
