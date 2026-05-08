# DashFrame E2E Tests

This directory contains end-to-end tests for the DashFrame web application using [Playwright](https://playwright.dev/) and [playwright-bdd](https://github.com/vitalets/playwright-bdd).

## Structure

We organize tests into two main categories: **Workflows** (User Journeys) and **Functional Areas** (Domain-specific).

```
e2e/web/features/
├── workflows/               # Critical User Journeys (CUJs) spanning multiple domains
│   ├── csv_to_chart.feature # "Upload CSV -> Create Chart" flow
│   └── json_to_chart.feature
├── data-sources/            # Deep functional testing of Data Source components
│   └── local_file_upload.feature
├── visualizations/          # Deep functional testing of Visualization components
│   └── ...
└── dashboards/              # Functional testing of Dashboard components
    └── ...
```

### 1. Workflows (`@workflow`)

These are our "Golden Paths" or Smoke Tests. They simulate a user traversing through the application to achieve a high-level goal.

- Focus on happy paths and integration between modules.
- Example: A user uploads a file, creates a chart, and adds it to a dashboard.

### 2. Functional Areas (`@data-source`, `@error`, etc.)

These tests focus on the specifics of a single domain or feature set.

- Focus on edge cases, validation, error handling, and component-specific interactions.
- Example: Verifying that the file uploader rejects an empty CSV or invalid JSON.

## Running Tests

### Recommended: Production Build (Self-contained)

Run tests against a production build. This is the recommended approach, especially when working in git worktrees where a dev server may not be running:

```bash
cd e2e/web
bun run test:e2e
```

This will:

1. Build the app to `.next-e2e` (separate from dev `.next`)
2. Start production server(s) on available ports
3. Run all tests (parallel locally, serial in CI)
4. Shut down the servers

**Local execution**: Each parallel worker gets its own server port for IndexedDB isolation.
**CI execution**: Single worker with single server for reliability.

### Filtering Tests

```bash
# Run only workflow tests (smoke tests)
bun run test:e2e --grep "@workflow"

# Run only data-source tests
bun run test:e2e --grep "@data-source"

# Run only error handling tests
bun run test:e2e --grep "@error"

# Run a specific test file
bun run test:e2e features/.generated/features/workflows/csv_to_chart.feature.spec.js
```

### List Tests Without Running

```bash
bun run test:e2e --list
```

## Adding New Tests

1. **Create a `.feature` file** in the appropriate directory:
   - `features/workflows/` for user journeys
   - `features/data-sources/` for data source functionality
   - etc.

2. **Add step definitions** in `steps/` if needed

3. **Regenerate test files**:

   ```bash
   bun bddgen
   ```

4. **Run tests** to verify:
   ```bash
   bun run test:e2e
   ```

## Test Fixtures

Test data files are stored in `fixtures/`:

- `sales_data.csv` - Sample CSV data
- `users_data.json` - Sample JSON data

## Debugging

### View Test Report

```bash
bun run test:html
```

### Run with UI Mode

```bash
bun run test:ui
```

### Run Headed (See Browser)

```bash
bun run test:headed
```

### Debug Mode (Step Through)

```bash
bun run test:debug
```
