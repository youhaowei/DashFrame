# Notion Data Caching Strategy

## Overview

Notion databases should be cached locally to minimize API calls and improve performance. Data should only be refetched when the user explicitly requests a refresh.

## Current Behavior

**Problem**: Every time a user navigates to a Notion data source or creates a visualization, the data is fetched from Notion's API, even if it was recently fetched.

**Flow**:
1. User connects to Notion or selects existing Notion source
2. User selects a database and properties
3. `queryDatabase` tRPC mutation fetches data from Notion API
4. DataFrame is created and linked to Insight
5. **Issue**: DataTable is created WITHOUT a `dataFrameId`, so data is not cached at the source level

## Desired Behavior

**Cache-First Approach**:
1. When fetching Notion data, cache the DataFrame in the DataTable
2. Display cached data by default
3. Show "last fetched" timestamp
4. Provide explicit "Refresh" button to re-fetch from Notion API
5. Only fetch data when:
   - First time configuring a database
   - User explicitly clicks "Refresh"

## Architecture

### Data Flow

```
Notion API → DataFrame → Cached in DataTable
                      ↓
                  Display in UI
                      ↓
              User clicks "Refresh"
                      ↓
              Re-fetch from API
                      ↓
          Update cached DataFrame
```

### Entity Relationships

```
NotionDataSource
  └── DataTable (Notion database config)
       ├── table: databaseId
       ├── dimensions: selected properties
       ├── dataFrameId: cached DataFrame (NEW)
       └── lastFetchedAt: timestamp (NEW)

Insight (Query/Transform)
  ├── dataTableIds: references DataTable(s)
  └── dataFrameId: result DataFrame

Visualization
  ├── source.dataFrameId: displays this DataFrame
  └── source.insightId: for refresh tracking
```

## Implementation Steps

### 1. Update DataTable Type

Add `lastFetchedAt` timestamp to track when data was last cached:

```typescript
export interface DataTable {
  id: UUID;
  name: string;
  sourceId: UUID;
  table: string;
  dimensions: string[];
  dataFrameId?: UUID; // Cached DataFrame (already exists)
  lastFetchedAt?: number; // NEW: Timestamp of last fetch
  createdAt: number;
}
```

### 2. Update CreateVisualizationModal

**Current**: DataTable is created without `dataFrameId`

```typescript
// ❌ Current: No caching
addDataTable(
  notionSource.id,
  `${selectedDatabaseId} Table`,
  selectedDatabaseId,
  selectedPropertyIds,
  // Missing: dataFrameId
);
```

**New**: Cache DataFrame in DataTable after fetching

```typescript
// ✅ New: Cache data in DataTable
const dataFrameId = createDataFrameFromInsight(...);

// Update DataTable with cached DataFrame
updateDataTable(
  notionSource.id,
  dataTableId,
  {
    dataFrameId,
    lastFetchedAt: Date.now(),
  }
);
```

### 3. Add Refresh Action to Store

Add `refreshDataTable` action to data-sources-store:

```typescript
interface DataSourcesActions {
  // ... existing actions
  refreshDataTable: (
    dataSourceId: UUID,
    dataTableId: UUID,
    dataFrameId: UUID
  ) => void;
}
```

Implementation:

```typescript
refreshDataTable: (dataSourceId, dataTableId, dataFrameId) => {
  set((state) => {
    const source = state.dataSources.get(dataSourceId);
    if (source) {
      const dataTable = source.dataTables.get(dataTableId);
      if (dataTable) {
        dataTable.dataFrameId = dataFrameId;
        dataTable.lastFetchedAt = Date.now();
      }
    }
  });
}
```

### 4. Add Refresh UI to DataSourceDisplay

**Location**: `apps/web/components/data-sources/DataSourceDisplay.tsx`

**UI Elements**:
1. Show "Last fetched: X minutes ago" below table count
2. Add "Refresh" button next to table name
3. Show loading state during refresh

**Example**:

```tsx
<CardDescription>
  Notion data source • {dataTables.length} tables
  {selectedDataTable?.lastFetchedAt && (
    <> • Last fetched: {formatRelativeTime(selectedDataTable.lastFetchedAt)}</>
  )}
</CardDescription>

{/* Refresh button */}
<Button
  variant="outline"
  size="sm"
  onClick={handleRefreshDataTable}
  disabled={isRefreshing}
>
  <Refresh className="mr-2 h-4 w-4" />
  {isRefreshing ? 'Refreshing...' : 'Refresh'}
</Button>
```

### 5. Implement Refresh Logic

Create `handleRefreshDataTable` function:

```typescript
const handleRefreshDataTable = async () => {
  if (!selectedDataTable || !dataSource || !isNotionDataSource(dataSource)) {
    return;
  }

  setIsRefreshing(true);
  try {
    // Re-fetch data from Notion API
    const dataFrame = await queryDatabaseMutation.mutateAsync({
      apiKey: dataSource.apiKey,
      databaseId: selectedDataTable.table,
      selectedPropertyIds: selectedDataTable.dimensions,
    });

    // Update DataFrame in store
    const dataFrameId = updateDataFrame(
      selectedDataTable.dataFrameId!,
      dataFrame
    );

    // Update DataTable with new lastFetchedAt
    refreshDataTable(
      dataSource.id,
      selectedDataTable.id,
      dataFrameId
    );

    toast.success('Data refreshed successfully');
  } catch (error) {
    toast.error('Failed to refresh data');
  } finally {
    setIsRefreshing(false);
  }
};
```

## User Flows

### First-Time Setup (New Database)

1. User connects to Notion
2. User selects database + properties
3. Data is fetched and cached
4. DataTable stores `dataFrameId` + `lastFetchedAt`
5. Visualization is created

### Using Existing Connection

1. User selects existing Notion source
2. Cached data is displayed immediately
3. UI shows "Last fetched: X minutes ago"
4. User can click "Refresh" to update data

### Refreshing Data

1. User clicks "Refresh" button
2. Loading state is shown
3. Data is re-fetched from Notion API
4. DataFrame is updated
5. DataTable's `lastFetchedAt` is updated
6. UI reflects new data

## Benefits

1. **Performance**: Cached data loads instantly
2. **API Usage**: Minimize Notion API calls
3. **User Control**: Explicit refresh gives users control
4. **Transparency**: "Last fetched" timestamp shows data freshness
5. **Reliability**: No unexpected API calls or rate limiting

## Edge Cases

### Missing Cached Data

If `dataFrameId` is missing (old data or corrupted state):
- Show "No data available" message
- Provide "Fetch Data" button
- Same flow as first-time setup

### API Errors

If refresh fails:
- Show error message
- Keep displaying cached data
- Allow retry

### Stale Data

If data is very old (e.g., > 7 days):
- Show warning: "Data may be outdated"
- Suggest refreshing

## Future Enhancements

1. **Auto-refresh**: Optional background refresh on interval
2. **Selective property refresh**: Update only changed properties
3. **Diff view**: Show what changed since last fetch
4. **Refresh all**: Bulk refresh all Notion tables
