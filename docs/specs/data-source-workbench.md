# Data Source Workbench

## Overview

The Data Source Workbench provides a unified interface for managing all data sources (Local, Notion, PostgreSQL). It uses the WorkbenchLayout pattern with a horizontal selector, left configuration panel, and main content area. The symmetric data source architecture ensures all source types (Local CSV, Notion, PostgreSQL) work consistently.

## Design Principles

1. **Symmetric Structure**: All data sources follow the same pattern (DataSource → DataTables)
2. **Consistent Layout**: Matches visualization workbench for familiar UX
3. **Type-Specific Details**: Each source type shows relevant configuration (API keys for Notion, file count for Local)
4. **Data Transparency**: Always show what data is available (tables, preview)
5. **Safe Actions**: Confirmations for destructive operations (delete)

## Component Architecture

### WorkbenchLayout Structure

```
┌─────────────────────────────────────────────────────────────┐
│  [Collapsible Selector: Data Sources]                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  [Local Storage] [Notion]  [+ New Data Source]     │   │
│  └─────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐  ┌────────────────────────────────────┐  │
│  │              │  │                                     │  │
│  │   Controls   │  │        Main Display                │  │
│  │   (360px)    │  │        (flexible)                  │  │
│  │              │  │                                     │  │
│  │  - Name      │  │  - Header (source info)            │  │
│  │  - Type      │  │  - DataTables list                 │  │
│  │  - Config    │  │  - Data preview                    │  │
│  │  - Metadata  │  │                                     │  │
│  │              │  │                                     │  │
│  │  [Actions]   │  │                                     │  │
│  │              │  │                                     │  │
│  └──────────────┘  └────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Components

1. **DataSourceSelector** - Top horizontal selector
   - Shows all data sources with type badges (LOCAL, NOTION, POSTGRESQL)
   - Displays metadata (table/file count)
   - "New Data Source" button
   - Empty state with helpful guidance

2. **DataSourceControls** - Left panel (360px)
   - Editable name field
   - Type display (read-only)
   - Type-specific configuration (API key for Notion, file count for Local)
   - Metadata section (created date, ID)
   - Actions footer (delete button in collapsible section)

3. **DataSourceDisplay** - Main content area
   - Header card (source name, type, summary stats)
   - DataTables section (for Notion/Local with tables)
   - Data preview (TableView component)
   - Empty states for each scenario

## User Flows

### Flow 1: View Local Data Source

**Steps**: 1 (select)

```
Selector
└─> Click "Local Storage"
    └─> Controls show: name, file count
        └─> Display shows: files list, data preview
```

**User Actions:**

1. Navigate to `/data-sources`
2. Click "Local Storage" in selector
3. View uploaded CSV files in main area
4. See data preview for first file

### Flow 2: View Notion Data Source

**Steps**: 1 (select)

```
Selector
└─> Click "Notion" connection
    └─> Controls show: name, API key, table count
        └─> Display shows: databases list, data preview
```

**User Actions:**

1. Navigate to `/data-sources`
2. Click "Notion" in selector
3. View configured databases
4. Select a database to preview cached data

### Flow 3: Edit Data Source Name

**Steps**: 1 (edit)

```
Controls Panel
└─> Click name input
    └─> Type new name
        └─> Auto-saved (Zustand)
```

**User Actions:**

1. Select data source
2. Click name field in left panel
3. Type new name
4. Changes save automatically

### Flow 4: Update Notion API Key

**Steps**: 1 (edit)

```
Controls Panel
└─> Click API key input
    └─> Paste new key
        └─> Auto-saved (Zustand)
```

**User Actions:**

1. Select Notion source
2. Click API key field in left panel
3. Paste new integration token
4. Changes save automatically

**Note**: Changing API key doesn't re-fetch data automatically. User must refresh visualizations or create new insights to use updated key.

### Flow 5: Delete Data Source

**Steps**: 2 (expand actions → confirm)

```
Controls Panel → Actions Footer
└─> Click "Actions" to expand
    └─> Click "Delete Data Source"
        └─> Confirm prompt
            └─> If YES: Delete source + DataTables + Insights + DataFrames
                └─> Select next available source
```

**User Actions:**

1. Select data source to delete
2. Scroll to bottom of left panel
3. Click "Actions" to expand collapsible section
4. Click "Delete Data Source" button
5. Confirm deletion in browser dialog
6. Source removed, next source selected

**Cascade Delete:**

- DataSource deleted
- All associated DataTables deleted
- All Insights referencing those DataTables deleted
- All DataFrames from those Insights deleted
- All Visualizations using those DataFrames deleted

### Flow 6: Add New Data Source

**Steps**: 1 (click button → modal)

```
Selector
└─> Click "+ New Data Source"
    └─> Open NewDataSourcePanel modal
        └─> Upload CSV or connect Notion
            └─> Source created
                └─> Auto-select new source
```

**User Actions:**

1. Click "+ New Data Source" in selector
2. Choose CSV upload or Notion connection
3. Complete flow (handled by NewDataSourcePanel)
4. New source appears in selector and auto-selects

## Layout Details

### Top Selector (DataSourceSelector)

**Collapsible Section:**

```
┌──────────────────────────────────────────────────────────┐
│  Data Sources                                        [▼] │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  [Search field]                                           │
│                                                           │
│  ┌───────────────┐  ┌───────────────┐  ┌──────────────┐│
│  │ 📁 Local      │  │ [N] Notion    │  │ + New Source ││
│  │ Storage       │  │               │  │              ││
│  │ LOCAL         │  │ NOTION        │  │              ││
│  │ 3 files       │  │ 5 tables      │  │              ││
│  └───────────────┘  └───────────────┘  └──────────────┘│
│                                                           │
└──────────────────────────────────────────────────────────┘
```

**States:**

- **Selected**: Blue border + blue background tint
- **Hover**: Gray background
- **Empty**: Shows only "+ New Source" with helpful message

### Left Panel (DataSourceControls)

**For Local Source:**

```
┌────────────────────────────────┐
│  Name                          │
│  ┌──────────────────────────┐ │
│  │ Local Storage            │ │
│  └──────────────────────────┘ │
│  Type: LOCAL                   │
│                                │
├────────────────────────────────┤
│  Configuration            [▼]  │
├────────────────────────────────┤
│  3 files                       │
│  Local storage (CSV uploads)   │
│                                │
├────────────────────────────────┤
│  Metadata                 [▼]  │
├────────────────────────────────┤
│  Created  Jan 15, 2025         │
│  ID       a1b2c3d4...          │
│                                │
├────────────────────────────────┤
│  Actions                  [▲]  │
├────────────────────────────────┤
│  [🗑 Delete Data Source]       │
└────────────────────────────────┘
```

**For Notion Source:**

```
┌────────────────────────────────┐
│  Name                          │
│  ┌──────────────────────────┐ │
│  │ Notion                   │ │
│  └──────────────────────────┘ │
│  Type: NOTION                  │
│                                │
├────────────────────────────────┤
│  Configuration            [▼]  │
├────────────────────────────────┤
│  API Key                       │
│  ┌──────────────────────────┐ │
│  │ ●●●●●●●●●●●●●●●●●●●●●●● │ │
│  └──────────────────────────┘ │
│  Your Notion integration token │
│                                │
│  5 tables                      │
│  Configured Notion databases   │
│                                │
├────────────────────────────────┤
│  Metadata                 [▲]  │
├────────────────────────────────┤
│  Created  Jan 10, 2025         │
│  ID       x7y8z9a0...          │
│                                │
├────────────────────────────────┤
│  Actions                  [▲]  │
├────────────────────────────────┤
│  [🗑 Delete Data Source]       │
└────────────────────────────────┘
```

**Collapsible Sections:**

- **Configuration**: Always open by default
- **Metadata**: Collapsed by default
- **Actions**: Collapsed by default (safety measure)

### Main Display (DataSourceDisplay)

**For Local Source:**

```
┌──────────────────────────────────────────────────────────┐
│  Local Storage                                           │
│  Local storage • 3 files                                 │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  Data Preview                                      [▼]   │
│  Showing sales-data.csv                                  │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  [TableView component - first 50 rows]                   │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

**For Notion Source:**

```
┌──────────────────────────────────────────────────────────┐
│  Notion                                                  │
│  Notion data source • 5 tables                           │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  Tables                                                  │
│  Configured Notion databases                             │
├──────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────┐   │
│  │ 📊 Sales Pipeline                          [DB] │   │
│  │ 8 properties                                     │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │ 📊 Customer Database                       [DB] │   │  ← Selected
│  │ 12 properties                                    │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │ 📊 Product Catalog                         [DB] │   │
│  │ 6 properties                                     │   │
│  └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  Data Preview                                      [▼]   │
│  Showing data from "Customer Database" • First 50 rows   │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  [TableView component - cached data]                     │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

**Empty States:**

_No Data Source Selected:_

```
┌──────────────────────────────────────┐
│  📁                                  │
│  No data source selected             │
│  Select a data source or create a    │
│  new one to configure settings.      │
└──────────────────────────────────────┘
```

_No DataTables:_

```
┌──────────────────────────────────────┐
│  🗂️                                   │
│  No tables configured                │
│  Create a visualization to add       │
│  Notion databases.                   │
└──────────────────────────────────────┘
```

## Visual Design

### Spacing & Layout

- **Selector**: Collapsible section, defaults to open
- **Left panel**: Fixed 360px width
- **Main content**: Flexible width, min-h-0 for proper scrolling
- **Gap between panels**: 1rem (16px)
- **Card padding**: 1.5rem (24px)

### Typography

- **Source name input**: Base size, medium weight
- **Section headers**: sm size, semibold weight
- **Labels**: xs size, medium weight, muted color
- **Body text**: sm size, regular weight
- **Metadata**: xs size, muted color

### Colors & States

- **Selected source**: Primary blue border + blue-50 background
- **Hover state**: Muted background
- **Input focus**: Blue ring
- **Destructive action**: Red button
- **Borders**: border-border/60 for cards, border-border/40 for dividers

### Icons

- **Local**: `File` or folder icon
- **Notion**: Notion logo (SiNotion)
- **PostgreSQL**: `Database` icon
- **Delete**: `Delete` icon
- **Expand/collapse**: `ChevronDown` icon

## Decision Rationale

### Why Symmetric DataSource Structure?

**Problem**: CSV and Notion had different structures (CSV had direct `dataFrameId`, Notion had `dataTables` Map). This asymmetry created special-case logic throughout the codebase.

**Solution**: All sources now have `dataTables: Map<UUID, DataTable>`. CSV files become DataTable entries.

**Benefits**:

- Consistent API across all source types
- Easier to add new source types (PostgreSQL, Snowflake, etc.)
- Simpler component logic (no type-specific branches)
- Clear mental model for users

### Why WorkbenchLayout Pattern?

**Consistency**: Matches visualization workbench layout, reducing cognitive load.

**Flexibility**: Left panel for configuration, main area for content display, optional right panel for future use.

**Responsive**: Panels can be hidden on smaller screens (future enhancement).

### Why Collapsible Sections in Controls?

**Progressive Disclosure**: Hide less-frequently-used information (metadata, actions) by default.

**Safety**: Destructive actions (delete) require expanding "Actions" section, reducing accidental clicks.

**Scanability**: Users focus on most relevant fields (name, configuration).

### Why Actions in Footer (Not Header)?

**Safety**: Delete button far from common interaction areas (name field, API key).

**Hierarchy**: Most important actions (edit name, configure) at top, destructive actions at bottom.

**Pattern**: Matches modal patterns where destructive actions appear in footers.

### Why Auto-Save for Edits?

**Simplicity**: No "Save" button to remember clicking.

**Immediate Feedback**: Changes apply instantly via Zustand.

**Familiar Pattern**: Matches how visualization controls work.

### Why Show DataTable Count vs List?

**Controls Panel**: Show count (summary) to keep panel concise.

**Main Display**: Show full list with details (cards) for data exploration.

**Information Hierarchy**: High-level summary in controls, detailed view in main area.

## Error Handling

### No Data Source Selected

**When**: User lands on `/data-sources` with no sources
**Display**: Empty state in both panels
**Message**: "No data source selected. Create a data source to get started."

### Data Source Not Found

**When**: Selected source ID not in store (deleted, invalid)
**Action**: Auto-select first available source, or show empty state
**Message**: "Data source not found. It may have been deleted."

### Missing DataFrames

**When**: DataTable has `dataFrameId` but DataFrame not found in store
**Display**: Show DataTable in list, but empty data preview
**Message**: "Data not loaded. Refresh visualization to load data."

### API Key Invalid (Future Enhancement)

**When**: Notion API key changed/revoked
**Display**: Warning in configuration section
**Message**: "API key may be invalid. Update key or test connection."
**Action**: Provide "Test Connection" button

## Accessibility

### Keyboard Navigation

- **Tab order**: Selector → Left panel fields → Main content → Footer actions
- **Enter**: Activate buttons, submit inputs
- **Escape**: Close expanded sections
- **Arrow keys**: Navigate DataTable list (future)

### Screen Readers

- All inputs have proper labels (`<Label>` components)
- Section headers announced clearly
- Button text descriptive (not icon-only)
- Loading/empty states announced
- Focus management when selecting sources

### Visual Accessibility

- **Touch targets**: Minimum 44x44px
- **Color contrast**: WCAG AA compliant
- **Focus indicators**: 2px blue ring on inputs
- **Form fields**: Clear labels, helper text
- **Collapsible sections**: Visual indication of expand/collapse state

## Future Enhancements

### Near-term

1. **Search/filter sources** - When many sources exist
2. **Duplicate source** - Clone configuration for similar sources
3. **Test connection** - Verify API keys work
4. **Refresh DataTables** - Re-fetch Notion databases without creating visualization
5. **Rename DataTables** - Custom names instead of database IDs

### Long-term

1. **Bulk operations** - Delete multiple DataTables at once
2. **Source groups/tags** - Organize sources by project/category
3. **Connection status** - Show if Notion connection is healthy
4. **Usage analytics** - Which sources/tables used most
5. **Export/import** - Share source configurations between users
6. **Collaborative editing** - Multiple users manage same sources
7. **Data lineage** - Show which visualizations depend on each source

## Testing Checklist

### Manual Testing

- [ ] Select Local source → shows correct info
- [ ] Select Notion source → shows correct info
- [ ] Edit source name → saves immediately
- [ ] Edit Notion API key → saves immediately
- [ ] Expand/collapse sections → state persists
- [ ] Delete source → confirmation works, cascade deletes
- [ ] Click "+ New Source" → modal opens
- [ ] Select DataTable → preview updates
- [ ] No sources → empty state shown
- [ ] Keyboard navigation works
- [ ] Screen reader announces correctly
- [ ] Mobile responsive (future)

### Integration Testing (Future)

- [ ] Create Local source → appears in selector
- [ ] Create Notion source → appears in selector
- [ ] Delete source → removed from all stores
- [ ] Edit source → updates persist to localStorage
- [ ] Multiple sources → selection works correctly
- [ ] Auto-select behavior → picks correct fallback

## Related Components

- **NewDataSourcePanel**: Modal for creating new sources (CSV upload, Notion connect)
- **CreateVisualizationModal**: Selects from existing sources or creates new ones
- **VisualizationsWorkbench**: Sister component using same WorkbenchLayout pattern
- **ItemSelector**: Reusable horizontal selector component
- **SidePanel**: Reusable panel with header/content/footer sections
- **TableView**: Data table display component
