# DashFrame product

What DashFrame is, what it commits to, and what it refuses to be. Read this before deciding whether a feature or an element belongs. For how things look and behave, see [DESIGN.md](DESIGN.md); for what things are called, see [GLOSSARY.md](GLOSSARY.md).

**What belongs in this file:** claims that stay true in eighteen months regardless of what ships. Plans, sequencing, pricing, positioning, and competitive analysis live in the private tracker, never here.

## The product

DashFrame is a local-first business intelligence tool for the data → chart journey: import data, query it with DuckDB, build visualizations, arrange them into dashboards. It ships as an Electron desktop app and a browser web app rendering the same UI.

The app is a **working instrument**, not a document and not a presentation. A user opens it to answer a question about their data and to keep that answer current. Brand register belongs to the marketing site; nothing in-app performs personality.

## The artifact model

Everything a user makes is an artifact with a name, a definition, and a result: data sources, insights, visualizations, dashboards. [GLOSSARY.md](GLOSSARY.md) is canonical for these terms and their model types.

**The model stays explicit and deterministic.** An artifact's definition is data a user can read, edit, and reason about — not a prompt, not an opaque inference. Assistance may author or revise a definition, but the definition remains the thing that runs. A user must always be able to see why a result looks the way it does.

## Commitments

- **Local-first.** Data lives on the user's machine. Query runs locally — native DuckDB on desktop, DuckDB-WASM in the browser. Working offline is normal operation, not degraded mode.
- **Sensitive data stays put.** Sensitivity is tracked per field and enforced at the cache-write gate: only cleared columns reach the on-disk cache. Enforcement is silent and fail-closed; the user-facing prompt appears where data would leave the local context.
- **Immediate.** The UI does not feel like it is waiting on a server. Interaction responds now; long work reports progress rather than freezing behind a spinner.
- **Truthful.** Show only what the product can compute and keep current. A number the product cannot defend is worse than no number.

## Non-goals

- **Not a document editor.** Artifacts are tools, not pages. Prose, layout, and presentation polish are not the job.
- **Not a collaboration platform.** Local-first is the ground; multiplayer editing, comment threads, and workspace permissioning are not what this product is for.
- **Not a monitoring or alerting system.** DashFrame answers questions and keeps answers current; it does not page anyone.
- **Not a warehouse.** DuckDB is the query engine, not a system of record for the business.

## How this decides things

Two rules follow from _truthful_ and from _working instrument_. Both are enforced as design rules in [DESIGN.md](DESIGN.md); this is why they exist.

**Every element earns its place.** An interface element exists to help a user understand state, make a decision, or perform an action. Visual completeness is not a reason to add one. Empty space is allowed.

**A signal earns its surface.** A badge, flag, or warning belongs on a surface only if it changes the user's judgment _there_. The same fact can be signal on one surface and noise on another, because the user's job differs. Track always, enforce silently, show only where it is decision-affecting.
