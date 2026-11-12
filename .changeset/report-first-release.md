---
"@dashframe/web": minor
---

DashFrame 0.3: reports you can build by hand or through an agent

- Reports are the primary object: the home page lists reports, a report is a canvas of tiles, and charts are edited in tabs inside the report.
- External agents connect over MCP with a named, revocable credential. They can read and draft; a person reviews the before/after diff and publishes.
- Google Analytics 4 connector with a Google sign-in that resumes after the browser step, plus streaming imports for GA4 and PostgreSQL.
- Saved results show which source and definition produced them and when they were last refreshed.
- Hosted web demo with private, single-owner workspaces.
- App-wide command palette, a shelf for recent and pinned items, and a settings page.
