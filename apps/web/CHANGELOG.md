# @dashframe/web

## 0.3.0

### Minor Changes

- [#546](https://github.com/youhaowei/DashFrame/pull/546) [`47a47b5`](https://github.com/youhaowei/DashFrame/commit/47a47b502dbce013126133cb4f7aa41e2dcba5be) Thanks [@youhaowei](https://github.com/youhaowei)! - DashFrame 0.3: reports you can build by hand or through an agent

  - Reports are the primary object: the home page lists reports, a report is a canvas of tiles, and charts are edited in tabs inside the report.
  - External agents connect over MCP with a named, revocable credential. They can read and draft; a person reviews the before/after diff and publishes.
  - Google Analytics 4 connector with a Google sign-in that resumes after the browser step, plus streaming imports for GA4 and PostgreSQL.
  - Saved results show which source and definition produced them and when they were last refreshed.
  - Hosted web demo with private, single-owner workspaces.
  - App-wide command palette, a shelf for recent and pinned items, and a settings page.

## 0.2.0

Baseline only. The 0.2 work shipped without a version bump or a tag, so this
entry moves the number to where the product already was. Changes are recorded
from 0.3.0 onward.

## 0.1.0

Initial release of DashFrame web application.
