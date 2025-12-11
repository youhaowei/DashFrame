# Create Visualization UX Flow

## Overview

The Create Visualization flow uses an action-based model with a two-level hierarchy. Users first select a data source, then select a table from that source, which automatically creates a draft insight and navigates to the insight page. The insight page serves as an action hub where users can create visualizations from recommendations, create custom visualizations, or join with another dataset.

## Design Principles

1. **Two-Level Hierarchy**: Data Sources → Tables drill-down pattern for better organization and scalability
2. **Action-Based Flow**: No rigid step sequences - users take actions from a central hub (the insight page)
3. **Immediate Feedback**: Selecting a table immediately creates an insight and navigates to the insight page with data preview
4. **Flexible Actions**: Multiple paths available from the insight page (recommendations, custom, join)
5. **Fast Path**: CSV sources auto-create data source, table, and insight, then navigate directly to insight page
6. **Consistent UX**: Same components and behavior across home page and modal flows

## User Flows

### Flow 1: Existing Data Source → Table → Insight Page

**Actions**: 2 (source selection → table selection → navigation)

```
Source Selection Modal or Home Page
└─> Click existing data source
    └─> Show tables for that source
        └─> Click on a table
            └─> Draft insight created automatically
                └─> Navigate to /insights/[id]
                    └─> Insight page with data preview and actions
```

**User Actions:**

1. Open Create Visualization modal (or use home page)
2. Click on existing data source
3. View list of tables for that source
4. Click on desired table
5. Automatically navigated to insight page with data preview
6. Choose action: Create from recommendation / Create custom / Join with another dataset

### Flow 2: New CSV Upload → Insight Page

**Actions**: 1 (immediate navigation)

```
Source Selection Modal or Home Page
└─> Upload CSV file
    └─> Parse & validate
        └─> Data source and table created automatically
            └─> Draft insight created automatically
                └─> Navigate to /insights/[id]
                    └─> Insight page with data preview and actions
```

**User Actions:**

1. Open Create Visualization modal (or use home page)
2. Click "Select CSV File" and choose file
3. Automatically navigated to insight page with data preview
4. Choose action: Create from recommendation / Create custom / Join with another dataset

### Flow 3: Existing Notion → Reuse Insight → Insight Page

**Actions**: 2 (connection → insight configuration → navigation)

```
Source Selection Modal or Home Page
└─> Click existing Notion connection
    └─> Show Notion Insight Configuration
        └─> Select "Use Existing Insight" tab
            └─> Click an existing insight
                └─> Click "Create Table Visualization"
                    └─> Navigate to /insights/[id]
                        └─> Insight page with data preview and actions
```

**User Actions:**

1. Open Create Visualization modal (or use home page)
2. Click on Notion connection
3. Click "Use Existing Insight" tab
4. Click on an insight
5. Click "Create Table Visualization"
6. Navigated to insight page with action options

### Flow 4: Existing Notion → New Insight → Insight Page

**Actions**: 2 (connection → configure → navigation)

```
Source Selection Modal or Home Page
└─> Click existing Notion connection
    └─> Show Notion Insight Configuration
        └─> Select "Create New Insight" tab
            └─> Select database
                └─> Select properties
                    └─> Click "Create Table Visualization"
                        └─> Navigate to /insights/[id]
                            └─> Insight page with data preview and actions
```

**User Actions:**

1. Open Create Visualization modal (or use home page)
2. Click on Notion connection
3. Click "Create New Insight" tab
4. Select database from dropdown
5. Select properties (all selected by default)
6. Click "Create Table Visualization"
7. Navigated to insight page with action options

### Flow 5: New Notion Connection → Insight Page

**Actions**: 2 (connect → configure → navigation)

```
Source Selection Modal or Home Page
└─> Enter Notion API key
    └─> Click "Connect"
        └─> Fetch databases
            └─> Show Notion Insight Configuration
                └─> Select database
                    └─> Select properties
                        └─> Click "Create Table Visualization"
                            └─> Navigate to /insights/[id]
                                └─> Insight page with data preview and actions
```

**User Actions:**

1. Open Create Visualization modal (or use home page)
2. Enter Notion API key (or use saved)
3. Click "Connect"
4. Select database from dropdown
5. Select properties (all selected by default)
6. Click "Create Table Visualization"
7. Navigated to insight page with action options

### Flow 6: Join Flow (from Insight Page)

**Actions**: 1 (join modal → navigation)

```
Insight Page
└─> Click "Join with another dataset" button
    └─> Join Flow Modal opens
        └─> Select secondary table (or upload CSV)
            └─> Configure join columns and type
                └─> Click "Combine Data"
                    └─> Joined insight created
                        └─> Navigate to /insights/[joined-id]
                            └─> Insight page for joined data
```

**User Actions:**

1. On insight page, click "Join with another dataset"
2. In modal, select secondary table from list or upload new CSV
3. Select join columns (left and right)
4. Choose join type (left, inner, outer, right)
5. Click "Combine Data"
6. Navigated to new insight page for joined data

## Action Hub: Insight Page

The insight page (`/insights/[id]`) serves as an action hub with multiple actions available:

1. **View Data Preview** - See table with data loaded from the source
2. **Create from Recommendation** - Click on a suggested chart card to create visualization immediately
3. **Create Custom Visualization** - Opens visualization builder (future implementation)
4. **Join with Another Dataset** - Opens join flow modal to combine current data with another table
5. **Manage Fields** - Select which fields to include in visualizations (future enhancement)

### Source Selection Modal

**Layout:**

```
┌─────────────────────────────────────┐
│  Create Visualization         [X]   │
├─────────────────────────────────────┤
│                                     │
│  Choose Data Source                 │
│                                     │
│  ┌─ Existing Sources ─────────────┐│
│  │                                 ││
│  │  📄 sales-data.csv             ││  ← Click = Create table
│  │  📄 customer-list.csv          ││
│  │                                 ││
│  │  [N] Notion                    ││  ← Click = Go to Step 2
│  │                                 ││
│  └─────────────────────────────────┘│
│                                     │
│  ┌─ Add New Source ───────────────┐│
│  │                                 ││
│  │  CSV File                       ││
│  │  Upload a CSV file              ││
│  │  [Select CSV File]              ││
│  │                                 ││
│  │  Notion Database                ││
│  │  Connect to your workspace      ││
│  │  API Key: [____________] [Show] ││
│  │  [Connect]                      ││
│  │                                 ││
│  └─────────────────────────────────┘│
│                                     │
│                        [Cancel]     │
└─────────────────────────────────────┘
```

**Existing Sources Section:**

- Only shown if data sources exist
- **CSV sources**: Click → Create table immediately
- **Notion connection**: Click → Go to Step 2 (insight configuration)
- Empty state: Show only "Add New Source" section

**Add New Source Section:**

- Always shown
- **CSV upload**: On success → Create table immediately
- **Notion connect**: On success → Go to Step 2

### Notion Insight Configuration

When a Notion source is selected, the modal shows Notion-specific configuration:

**Two Modes Based on Connection Type:**

#### Mode A: Existing Notion Connection

Shows tabs to choose between reusing or creating insights.

**Layout:**

```
┌─────────────────────────────────────┐
│  Create Visualization         [X]   │
├─────────────────────────────────────┤
│                                     │
│  Configure Insight                  │
│                                     │
│  [Use Existing] [Create New]        │  ← Tab switcher
│                                     │
│  ┌─ Use Existing Insight ──────────┐│
│  │                                 ││
│  │  💡 Q4 Sales                    ││  ← Click to select
│  │     Database: Sales • 5 cols    ││
│  │                                 ││
│  │  💡 Customer Pipeline           ││
│  │     Database: CRM • 8 cols      ││
│  │                                 ││
│  └─────────────────────────────────┘│
│                                     │
│  [Back]    [Create Table Visualization]
└─────────────────────────────────────┘
```

**"Create New" Tab:**

```
┌─────────────────────────────────────┐
│  Create Visualization         [X]   │
├─────────────────────────────────────┤
│                                     │
│  Configure Insight                  │
│                                     │
│  [Use Existing] [Create New]        │  ← Tab switcher
│                                     │
│  ┌─ Create New Insight ────────────┐│
│  │                                 ││
│  │  Select Database                ││
│  │  [Choose database...         ▼] ││
│  │                                 ││
│  │  Select Properties              ││
│  │  ┌───────────────────────────┐ ││
│  │  │ ☑ Name          title     │ ││
│  │  │ ☑ Status        status    │ ││
│  │  │ ☑ Amount        number    │ ││
│  │  │ ☐ Tags          multi_sel │ ││
│  │  └───────────────────────────┘ ││
│  │                                 ││
│  └─────────────────────────────────┘│
│                                     │
│  [Back]    [Create Table Visualization]
└─────────────────────────────────────┘
```

#### Mode B: New Notion Connection

Shows only database/property selection (no tabs needed).

**Layout:**

```
┌─────────────────────────────────────┐
│  Create Visualization         [X]   │
├─────────────────────────────────────┤
│                                     │
│  Configure Insight                  │
│                                     │
│  Select Database                    │
│  [Choose database...             ▼] │
│                                     │
│  Select Properties                  │
│  ┌─────────────────────────────────┐│
│  │ ☑ Name            title        ││
│  │ ☑ Status          status       ││
│  │ ☑ Amount          number       ││
│  │ ☐ Tags            multi_select ││
│  └─────────────────────────────────┘│
│                                     │
│  [Back]    [Create Table Visualization]
└─────────────────────────────────────┘
```

**Behavior:**

- **Existing Notion**: Show tabs ("Use Existing" vs "Create New")
- **New Notion**: Show only database/property selection
- All properties selected by default
- Must select at least one property to enable Create button

## Visual Design

### Icons

- **CSV files**: `File` icon from `@dashframe/ui/icons`
- **Notion connection**: Custom Notion SVG logo
- **Insights**: `LuDatabase` icon from `react-icons/lu`
- **Plus/Add**: `LuPlus` icon from `react-icons/lu`

### Colors

- **Primary action**: Blue (#2563eb)
- **Hover state**: Blue-50 background (#eff6ff)
- **Selected state**: Blue-100 background (#dbeafe) with blue border
- **Error state**: Red (#dc2626)
- **Text**: Gray-900 (#111827) for primary, Gray-600 (#4b5563) for secondary

### Spacing & Layout

- Modal width: 672px (max-w-2xl)
- Modal padding: 1.5rem (p-6)
- Section gap: 1rem (gap-4)
- Card padding: 1rem (p-4)
- Button height: 40px (h-10)

### Typography

- **Modal title**: 2xl font size, bold weight
- **Section headers**: lg font size, semibold weight
- **Body text**: base font size, regular weight
- **Helper text**: sm font size, gray-600 color

## Component Architecture

The visualization creation flow is built using a composable component architecture for maintainability and reusability.

### Shared UI Components (`@dashframe/ui`)

1. **ClickableItemCard** - Reusable card component for selectable items
   - Props: `icon`, `title`, `subtitle`, `badge`, `onClick`, `selected`
   - Used for: data sources, tables, insights, any clickable list items
   - Supports: hover states, selection highlighting, accessibility

2. **SectionList** - Container for sections with header and grid layout
   - Props: `title`, `children`, `emptyMessage`
   - Standardizes: section headers, spacing, grid layouts
   - Used in: home page, modals, anywhere lists of items appear

### Domain-Specific Components (`apps/web/components/data-sources/`)

1. **DataSourceList** - Displays list of data sources
   - Uses: `ClickableItemCard` for each source
   - Shows: source name, table count, source type badge
   - Handles: source selection for drill-down

2. **DataTableList** - Displays list of tables
   - Uses: `ClickableItemCard` for each table
   - Shows: table name, source name, field count, local/remote badge
   - Handles: table selection → insight creation

3. **NotionConfigPanel** - Notion-specific configuration UI
   - Handles: database selection, property selection, submission
   - Shows: loading states, validation, property checkboxes
   - Extracted from: `CreateVisualizationContent` (180 lines)

4. **AddConnectionPanel** - Upload/connect new data sources
   - Supports: CSV upload, Notion API key input
   - Reusable across: home page and modal flows
   - Handles: file validation, API connection

### Custom Hooks (`apps/web/hooks/`)

1. **useLocalStoreHydration** - SSR-safe Zustand store hydration
   - Rehydrates: data sources and insights stores
   - Provides: `isHydrated` flag, `localSources` array
   - Pattern: Wait for hydration before rendering data-dependent UI

2. **useDataTables** - Aggregate tables from data sources
   - Transforms: nested DataSource → DataTable structure to flat list
   - Supports: optional filtering by source ID
   - Returns: `allDataTables`, `getTablesForSource()`

3. **useCSVUpload** - CSV file parsing and validation
   - Uses: PapaParse for parsing
   - Handles: errors, loading states, validation
   - Calls: `handleLocalCSVUpload` from local-csv-handler
   - Pattern: Accepts success callback for navigation

4. **useCreateInsight** - Standardize insight creation
   - Creates: draft insight with empty selectedFields
   - Navigates: to `/insights/[id]` after creation
   - Used by: CSV upload, table selection, all insight creation flows

### Architecture Benefits

- **41% code reduction** in CreateVisualizationContent (677 → 397 lines)
- **Eliminated 5+ duplications** of clickable card pattern
- **Consistent behavior** across home page and modal
- **Easy testing** - hooks and components are independently testable
- **Clear separation** of concerns (UI, data, business logic)
- **Reusability** - components used in multiple flows

## Decision Rationale

### Why Default to Table?

- **Most flexible**: Shows all data without transformation
- **Data verification**: Users can immediately see if data loaded correctly
- **Progressive enhancement**: Type can be changed later in main UI
- **Reduces cognitive load**: Eliminates unnecessary choice upfront

### Why Two-Level Hierarchy (Sources → Tables)?

- **Scalability**: 10 sources × 5 tables = 50 items, but users only see 10 initially
- **Organization**: Related tables grouped under their source
- **Context**: Users know which source they're working with
- **Progressive disclosure**: Show overview first, drill into details
- **Mental model**: Matches file system and database browser patterns

### Why Show Existing Sources First?

- **Encourages reuse**: Prevents duplicate data sources
- **Faster workflow**: Two-click selection for existing tables
- **Better organization**: Keeps data sources list manageable
- **User familiarity**: Users see what they already have

### Why Allow New Insights from Existing Connections?

- **Flexibility**: Different views of same Notion workspace
- **Avoids reconnection**: No need to re-enter API key
- **Exploration**: Encourages trying different database/property combinations
- **Efficiency**: Reuses authenticated connection

### Why Tabs for Existing vs New Insights?

- **Clear separation**: Distinct workflows for reuse vs create
- **Reduces cognitive load**: One choice at a time
- **Familiar pattern**: Standard UI pattern users understand
- **Flexible layout**: Can expand either section without overlap

### Why Action-Based Flow?

- **Flexibility**: Users can take different actions from the same page
- **No dead ends**: All actions available at once, no need to backtrack
- **Clear options**: Action hub makes all possibilities visible
- **Progressive enhancement**: Start with recommendations, customize or join as needed

### Why Auto-Navigate to Insight Page?

- **Immediate feedback**: Users see their data right away in a table preview
- **Context preservation**: Data preview shows what they're working with
- **Action clarity**: All next steps visible in one place (recommendations, custom, join)
- **Reduced modal complexity**: Source selection is simple, actions happen on dedicated page
- **Natural flow**: Data → Insight → Visualization follows the domain model

## Error Handling

### CSV Upload Errors

| Error          | Message                                         | Action                         |
| -------------- | ----------------------------------------------- | ------------------------------ |
| Parse failure  | "CSV parsing failed. Please check file format." | Show error below upload button |
| Empty file     | "CSV file is empty or contains no valid data."  | Show error below upload button |
| No headers     | "CSV must contain headers in the first row."    | Show error below upload button |
| File too large | "File size exceeds 5MB limit."                  | Show error below upload button |
| No columns     | "CSV did not contain any columns."              | Show error below upload button |

### Notion Connection Errors

| Error                | Message                                                      | Action                             |
| -------------------- | ------------------------------------------------------------ | ---------------------------------- |
| Invalid API key      | "Failed to connect to Notion. Please check your API key."    | Show error below Connect button    |
| No databases         | "No databases found. Make sure your integration has access." | Show warning message after connect |
| Network error        | "Connection failed. Please check your internet connection."  | Show error below Connect button    |
| Schema fetch failure | "Failed to fetch database schema."                           | Show error in Step 2               |

### Insight Configuration Errors

| Error                  | Message                                               | Action                |
| ---------------------- | ----------------------------------------------------- | --------------------- |
| No properties selected | N/A                                                   | Disable Create button |
| Database query failed  | "Failed to fetch data from Notion. Please try again." | Show error message    |
| Empty result           | "No data found in the selected database."             | Show error message    |

### Error Display Guidelines

- Show errors inline near the relevant input
- Use red border + red text for error states
- Provide actionable error messages
- Clear errors when user takes corrective action

## Future Enhancements

### Near-term Improvements

1. **Search/filter existing sources** - When list grows beyond 5-10 items
2. **Preview data sample** - Show first few rows before creating visualization
3. **Insight naming** - Allow custom names for new insights
4. **Recent sources shortcut** - Quick access to last 3 used sources

### Long-term Enhancements

1. **Drag & drop CSV upload** - Faster file selection
2. **Duplicate insight** - Clone existing configuration
3. **Keyboard shortcuts** - Power user optimization
4. **Bulk operations** - Create multiple visualizations at once
5. **Visualization type selection** - Optional step if needed later
6. **Smart defaults** - Suggest visualization based on data types

## Accessibility

### Keyboard Navigation

- **Tab order**: Existing sources → New sources → Buttons
- **Enter**: Activate selected item
- **Escape**: Close modal
- **Arrow keys**: Navigate within lists (future enhancement)

### Screen Readers

- All inputs have proper labels
- Section headers announced clearly
- Button text is descriptive (no icon-only)
- Loading and error states announced
- Focus management when navigating steps

### Visual Accessibility

- **Touch targets**: Minimum 44x44px
- **Color contrast**: WCAG AA compliant
- **Focus indicators**: Clear 2px blue outline
- **Error indication**: Icon + text (not color alone)
- **Loading states**: Spinner + text label

## Testing Checklist

### Unit Tests (Future)

- [ ] CSV parsing with valid/invalid files
- [ ] Notion API connection success/failure
- [ ] Property selection validation
- [ ] Navigation flow logic

### Integration Tests (Future)

- [ ] Complete CSV upload flow
- [ ] Complete Notion connection flow
- [ ] Existing source selection
- [ ] Error state handling

### Manual Testing

- [ ] Test with no existing sources (first-time user)
- [ ] Test with multiple CSV sources
- [ ] Test with Notion connection + insights
- [ ] Test switching between tabs in Step 2
- [ ] Test error states for all failure modes
- [ ] Test keyboard navigation
- [ ] Test mobile responsive layout
- [ ] Test with screen reader
