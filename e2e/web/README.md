# DashFrame E2E Tests

This directory contains end-to-end tests for the DashFrame web application using [Playwright](https://playwright.dev/) and [playwright-bdd](https://github.com/vitalets/playwright-bdd).

## Structure

We organize tests into two main categories: **Workflows** (User Journeys) and **Functional Areas** (Domain-specific).

```
e2e/web/features/
├── workflows/               # Critical User Journeys (CUJs) spanning multiple domains
│   ├── csv-to-chart.feature # e.g., "Upload CSV -> Create Chart" flow
│   └── ...
├── data-sources/            # Deep functional testing of Data Source components
│   ├── csv-upload.feature   # e.g., Edge cases for CSV parsing
│   └── ...
├── visualizations/          # Deep functional testing of Visualization components
│   ├── chart-types.feature  # e.g., Rendering specifics for different charts
│   └── ...
└── dashboards/              # functional testing of Dashboard components
    └── ...
```

### 1. Workflows

These are our "Golden Paths" or Smoke Tests. They simulate a user traversing through the application to achieve a high-level goal.

- Focus on happy paths and integration between modules.
- Example: A user logs in, uploads a file, creates a chart, and adds it to a dashboard.

### 2. Functional Areas (`data-sources`, `visualizations`, etc.)

These tests focus on the specifics of a single domain or feature set.

- Focus on edge cases, validation, error handling, and component-specific interactions.
- Example: Verifying that the CSV uploader rejects an empty file or correctly infers data types.

## Running Tests

### Development

Run tests in development mode (fast iteration, uses `bun dev`):

```bash
E2E_MODE=dev bun test
```

### Production

Run tests against a production build (replicates exact user environment):

```bash
bun test
```

### Filtering Tests

Run only core workflows:

```bash
E2E_MODE=dev bun test --grep "@core"
```
