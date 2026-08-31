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

Selected after user review: one content-grid pattern for every collection route: Data Sources, Insights, Visualizations, Dashboards, Drafts, and Data Frames. Applying the grid only to Data Sources left the interface inconsistent; the common pattern now lives in shared components instead of page-specific markup.

`ArtifactCollection` owns the title, count, primary action, search, tools, and content spacing. `ArtifactGrid` owns column widths and gaps. `ArtifactCard` owns icon sizing, text hierarchy, minimum height, focus treatment, and menu placement. `ArtifactEmptyState` owns empty and no-match layouts. Cards may show different factual metadata, but pages do not choose their own layout. Navigation links and action menus remain separate.

Source detail retains Claude C's compact searchable picker. No synthetic thumbnails or health summaries are added. Actual data previews remain tables; collection cards are for browsing artifacts, not comparing data rows.

## First slice

- Shared artifact page identity, description, navigation, actions, and optional tools row.
- Shared content grids across all six collection routes, with the same card and empty-state components.
- Insight groups preserve the existing bulk draft-deletion workflow. Draft cards retain explicit discard confirmation. Data Frames retain name/creation-date sorting and rename/delete actions; they do not invent a detail route.
- Source detail uses transient source/table selectors instead of a permanent table rail. Source switching navigates to another artifact; it never rewrites an Insight's source.
- The first available table is visible by default. A selection not present in the current source falls back to that source's first table, including after deletion.
- Dashboard detail adopts the shared header while keeping its existing controls and grid.

Mocks are local, untracked review artifacts at `.data/prototypes/artifact-surfaces/index.html`. Serve the directory on loopback or open the HTML directly. They use realistic illustrative fixtures, not live project data. Screenshot evidence belongs outside the repository.

## Remaining v0.3 work

Adopt the shared identity header in Insight and Visualization editors while preserving editor controls and context rails. Improve the creation/join data picker separately; it owns import and exclusion behavior and is not interchangeable with navigation between artifact pages.

Optional polish: meaningful previews generated from actual chart content; additional sorting when a demonstrated collection workflow needs it. None is required to establish the shared structure.
