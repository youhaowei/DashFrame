# Artifact surfaces

The v0.3 UI slice keeps the existing application shell and gives artifact collections and detail pages a shared structure. It does not change storage, source definitions, assistant ownership, or the design-system submodules.

## Audit and decision

The source, insight, and visualization collections duplicated their page headers, full-width search inputs, rows, and menu wrappers. Their Created dates occupied a line on every row without helping identify the data. Insight state badges repeated the group headings. Clickable Card containers did not provide a normal keyboard-accessible link to the detail page.

Source detail used a fixed 320px table list beside the content, plus nested header padding. It computed the first table for preview loading but did not render that detail until the user clicked a table. Source, insight, and visualization details already share AppLayout; dashboard detail has a separate body and header. The existing DataSourceSelector component is unused by these routes.

Three coded mocks were compared against the existing Claude C prototype, holding the shell constant:

| Direction                       | Information usefulness                     | Horizontal space                            | Across artifact types                         | Constrained widths         | Shell fit                  |
| ------------------------------- | ------------------------------------------ | ------------------------------------------- | --------------------------------------------- | -------------------------- | -------------------------- |
| Quiet list                      | Name and identifying context stay together | No permanent secondary rail                 | Useful without invented previews              | Names truncate; tools wrap | Interior-only change       |
| Content grid                    | Keeps artifact identity in distinct cards  | Uses broad collection pages well            | Compact cards work without synthetic previews | Collapses to one column    | Interior-only change       |
| Compact index + detail metadata | Fast scanning; details move off the row    | Detail metadata rail consumes content width | Metadata needs vary substantially             | Rail must stack            | Adds an unnecessary region |

Selected after user review: use one content-grid pattern for the user-facing collections, with **Reports** as the primary object, **Data Sources** as reusable inputs, and **Drafts** as the review inbox. Insights and Visualizations remain separate artifacts in the data model, but they are nested within a Report rather than exposed as peer collections. Data Frames are internal query results and appear only as contextual data previews or technical inspection details.

`ArtifactCollection` owns the title, count, primary action, search, tools, and content spacing. `ArtifactGrid` owns column widths and gaps. `ArtifactCard` owns icon sizing, text hierarchy, a minimum card height, focus treatment, and menu placement. `ArtifactEmptyState` owns empty and no-match layouts. Cards may show different factual metadata, but pages do not choose their own layout. Navigation links and action menus remain separate.

Source detail retains Claude C's compact searchable picker. No synthetic thumbnails or health summaries are added. Actual data previews remain tables; collection cards are for browsing artifacts, not comparing data rows.

Search appears only when a collection has items or a query is active. An empty collection shows its empty state without a search field; a search that returns no matches keeps the field so the filter can be cleared.

Source identity uses the connector's brand logo when one exists; preserve its proportions and colors. File sources use recognizable file-type icons for CSV and JSON, and the local-file icon for uploads. Use a neutral fallback only for unknown connectors. Production resolves these assets through connector metadata and the existing sanitized icon renderer.

Interface labels use sentence case, not decorative uppercase or widely spaced capitals. Preserve conventional acronyms and product names such as CSV, JSON, SQL, and PostgreSQL.

## First slice

- Shared artifact page identity, description, navigation, actions, and optional tools row.
- Shared content grids across Reports, Data Sources, and Drafts, with the same card and empty-state components.
- Reports use the existing Dashboard collection and routes. Questions and their saved Visualization views are reached from the Report context; the project-level Questions view remains a secondary entry from Reports.
- Draft cards retain explicit discard confirmation and derive their collection summary from named affected artifacts and deterministic command intents.
- Data Frames have no navigation root. Their existing inspection route remains available from source and question detail.
- Source detail uses transient source/table selectors instead of a permanent table rail. Source switching navigates to another artifact; it never rewrites an Insight's source.
- The first available table is visible by default. A selection not present in the current source falls back to that source's first table, including after deletion.
- Report detail adopts the shared header while keeping its existing controls and grid.

Collection pages are page content inside the shell's existing surface panel; they do not paint their own canvas or float a second panel within it. `DESIGN.md`'s panel recipe governs the top-level shell regions, not the cards inside them.

Mocks are local, untracked review artifacts at `.data/prototypes/artifact-surfaces/index.html`. Serve the directory on loopback or open the HTML directly. They use realistic illustrative fixtures, not live project data. Screenshot evidence belongs outside the repository.

## Card information rule

Every visible field must help identify the artifact, explain its contents, or support the next decision. Cards share a minimum height so a sparse collection still reads as a grid, and they grow to fit their content rather than truncating it. The interface does not invent metadata, badges, or placeholder charts to fill that minimum. Omit an unavailable optional fact rather than rendering "Unknown"; when information is genuinely required to proceed, explain the missing step instead. Counts and timestamps are supporting details, not substitutes for meaning.

Each collection has an explicit content budget:

| Collection   | Useful card content                                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reports      | Name, question count, saved-view count; an empty Report prompts adding its first question.                                                                                                  |
| Data Sources | Connector logo or file-type icon, source name, format or connector, table count.                                                                                                            |
| Drafts       | Primary affected artifact or mechanical title, up to two deterministic command descriptions, review action; count and time as secondary context. Overflow becomes a factual "+N more" line. |

### What this rule does not yet describe

The budget above is the target, not a report on the shipped cards. Two gaps remain:

- Data Frames cards render six metadata lines (source, definition, dimensions, last
  refreshed, storage, created) against a budget of three, and they print "Unknown source",
  "Unknown table", "Unknown" and "? rows x ? columns" where a fact is missing — which the
  omission rule above forbids. Insight cards do the same with "Unknown table". Those strings
  predate this slice; the rule that indicts them does not.
- Interface labels outside the Report hierarchy are still mixed: "Delete Table" and
  "Edit Data Frame" sit beside "Save changes", "Clear search" and "Rename source". The
  sentence-case pass remains outstanding on those adjacent surfaces.

## Draft collection content

Draft cards identify the affected artifacts and summarize the proposed changes: a reader should see what they would be reviewing, not only how many changes there are. Generate that summary without an LLM — group typed commands by artifact and render their deterministic `command.describe()` intent lines. Command paths are not useful titles. If no authored title exists, use the primary affected artifact name, or a mechanical fallback such as "3 proposed updates". Keep the shared card structure, but let the body carry a short review summary without truncating the main change description.

An agent or human may attach requested context explaining why the draft exists; keep it in the review detail rather than repeating it on the collection card. The deterministic command descriptions remain the verifiable account of what publishing will change.

`listDrafts` returns a lightweight summary using the same named-node and intent shape as `draftPublishReview.diff`. It reads the stored command log and materialized draft-change rows, returns at most two intent lines plus a remaining count, and does not load the full workspace graph or execute a preview for each collection card. Artifact names come from the stored before/proposed rows, never command paths.

## Verified data availability

A display field must map to a saved field, a deterministic derivation, or an explicitly identified implementation dependency. The mocks are illustrative, not live project data.

| Display content                       | Current evidence                                                                                                       | Delivery constraint                                                                                                                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Source identity and table count       | `DataSource.name`/`type`, connector metadata, related DataTables                                                       | Available through existing list queries. File format must come from known import metadata; otherwise use the connector name.                                                                                 |
| Insight configuration summary         | `Insight.selectedFields`, `metrics`, `filters`, `joins`; field names resolved from metadata                            | Format values mechanically. No AI-authored business narrative.                                                                                                                                               |
| Visualization identity and provenance | `Visualization.name`/`visualizationType`/`insightId`/`encoding`                                                        | Existing list metadata. Saved types are barY, barX, line, areaY, dot, hexbin, heatmap, and raster; Table is not a saved type.                                                                                |
| Visualization thumbnail               | Saved encoding/spec plus actual Insight result data                                                                    | Feasible only with result loading and rendering; no thumbnail field exists. Show an unavailable state until real content can be rendered, and do not execute every visualization eagerly on collection load. |
| Dashboard layout and counts           | `Dashboard.items[].type`/`x`/`y`/`width`/`height`/`visualizationId`                                                    | Geometry and typed counts are direct. Chart images require rendering with saved per-widget overrides, never reusing an unrelated chart.                                                                      |
| Draft identities and changes          | `draftPublishReview.diff.directNodes[].name`/`intent` plus `listDrafts.summary` from stored commands and draft changes | Detailed review carries full before/proposed definitions; the list contract returns only named nodes, at most two deterministic intent lines, and a remaining count.                                         |

## Remaining v0.3 work

Adopt the shared identity header in Insight and Visualization editors while preserving editor controls and context rails. Improve the creation/join data picker separately; it owns import and exclusion behavior and is not interchangeable with navigation between artifact pages.

Optional polish: previews generated from actual chart content, and additional sorting when a demonstrated collection workflow needs it. Neither is required to establish the shared structure, and neither may be faked — a preview shows real content or an honest fallback.
