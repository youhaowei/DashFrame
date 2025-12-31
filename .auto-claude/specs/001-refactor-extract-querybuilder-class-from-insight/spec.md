# Specification: Refactor Extract QueryBuilder Class from Insight

## Overview

This task addresses GitHub Issue #4 which requires adding comprehensive test coverage for the `QueryBuilder` class in the `@dashframe/engine-browser` package. The refactoring from `Insight` to `QueryBuilder` appears to be complete - a dedicated `QueryBuilder` class exists with SQL generation capabilities including filtering, sorting, grouping, joins, and aggregations. The primary remaining deliverable is test coverage for the QueryBuilder functionality to ensure reliability and prevent regressions.

## Workflow Type

**Type**: refactoring

**Rationale**: This is a code quality improvement task focused on adding test coverage to an existing implementation. The QueryBuilder class already exists with all required methods, but lacks unit tests. This workflow type fits because we're improving code quality without changing functionality.

## Task Scope

### Services Involved
- **engine-browser** (primary) - Contains QueryBuilder class that needs test coverage
- **connector-csv** (reference) - Example test patterns to follow

### This Task Will:
- [ ] Create comprehensive unit tests for `QueryBuilder` class
- [ ] Test all query builder methods: `filter()`, `sort()`, `groupBy()`, `join()`, `limit()`, `offset()`, `select()`
- [ ] Test SQL generation methods: `sql()`, `toSQL()`, `rows()`, `count()`, `preview()`
- [ ] Test static `batchQuery()` method
- [ ] Test helper functions: `formatPredicate()`, `buildPlan()`, `buildSelectClause()`, `buildOrderClause()`
- [ ] Test edge cases: empty operations, null values, special characters in identifiers
- [ ] Verify the Insight class properly delegates to QueryBuilder (if applicable)

### Out of Scope:
- Modifying the QueryBuilder implementation logic
- Refactoring the Insight class's `generateJoinSQL` method (separate concern)
- Adding E2E tests requiring actual DuckDB-WASM execution
- Performance optimization

## Service Context

### engine-browser (Primary)

**Tech Stack:**
- Language: TypeScript
- Framework: None (library package)
- Testing: Vitest
- Key Dependencies: @duckdb/duckdb-wasm, apache-arrow, idb-keyval

**Key directories:**
- `src/` - Source code

**Entry Point:** `src/index.ts`

**How to Run:**
```bash
cd packages/engine-browser
npm run test
```

**Port:** N/A (library package)

**Test Command:**
```bash
npm run test
# or from root
npx turbo run test --filter=@dashframe/engine-browser
```

## Files to Modify

| File | Service | What to Change |
|------|---------|---------------|
| `packages/engine-browser/src/query-builder.test.ts` | engine-browser | Create new test file with comprehensive QueryBuilder tests |
| `packages/engine-browser/src/insight.test.ts` | engine-browser | Create new test file for Insight class SQL generation |

## Files to Reference

These files show patterns to follow:

| File | Pattern to Copy |
|------|----------------|
| `packages/connector-csv/src/connector.test.ts` | Vitest test structure, mocking patterns, describe/it organization |
| `packages/engine-browser/src/query-builder.ts` | QueryBuilder class implementation, methods to test |
| `packages/engine-browser/src/insight.ts` | Insight class implementation, SQL generation methods |
| `packages/engine-browser/package.json` | Test configuration with Vitest |

## Patterns to Follow

### Vitest Test Structure

From `packages/connector-csv/src/connector.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("QueryBuilder", () => {
  let queryBuilder: QueryBuilder;
  let mockConn: AsyncDuckDBConnection;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    // Setup test fixtures
  });

  describe("filter operations", () => {
    it("should add filter predicates to query", () => {
      // Test implementation
    });
  });
});
```

**Key Points:**
- Use `describe` blocks to group related tests
- Use `beforeEach` for test setup and mock clearing
- Use `vi.mock()` for mocking dependencies
- Follow naming convention: `[component].test.ts`

### Mocking DuckDB Connection

For unit tests, mock the DuckDB connection:

```typescript
const mockConn = {
  query: vi.fn().mockResolvedValue({
    toArray: () => [{ count: 10 }],
  }),
  insertArrowFromIPCStream: vi.fn().mockResolvedValue(undefined),
} as unknown as AsyncDuckDBConnection;
```

**Key Points:**
- Mock at the connection level to avoid DuckDB-WASM initialization
- Return realistic mock data structures
- Test SQL string generation separately from execution

## Requirements

### Functional Requirements

1. **QueryBuilder Method Tests**
   - Description: Each chainable method (`filter`, `sort`, `groupBy`, `join`, `limit`, `offset`, `select`) should be tested for correct operation accumulation
   - Acceptance: All methods return new QueryBuilder instances with proper operations added

2. **SQL Generation Tests**
   - Description: Test that `sql()` and `toSQL()` produce correct SQL strings for various query configurations
   - Acceptance: Generated SQL matches expected format for SELECT, WHERE, GROUP BY, ORDER BY, LIMIT, OFFSET clauses

3. **Helper Function Tests**
   - Description: Test `formatPredicate`, `buildPlan`, `buildSelectClause`, `buildOrderClause` functions
   - Acceptance: Each helper produces correct output for all supported operators and configurations

4. **Immutability Tests**
   - Description: Verify QueryBuilder uses immutable chaining (returns new instance, doesn't modify original)
   - Acceptance: Original QueryBuilder unchanged after method calls

5. **Edge Case Tests**
   - Description: Test boundary conditions, null handling, special characters
   - Acceptance: No errors thrown for valid edge cases, appropriate errors for invalid input

### Edge Cases

1. **Empty Operations** - QueryBuilder with no operations should return `SELECT * FROM table`
2. **NULL Values** - Filter predicates with NULL should use `IS NULL` operator
3. **Special Characters** - Column names with quotes/spaces should be properly escaped
4. **Multiple Filters** - Multiple filter operations should combine with AND
5. **Empty Result Set** - `count()` should return 0 for empty results
6. **Large LIMIT Values** - Should handle large numeric limits without overflow

## Implementation Notes

### DO
- Follow the test patterns in `packages/connector-csv/src/connector.test.ts`
- Use `vi.mock()` to mock DuckDB connection and storage dependencies
- Test SQL string output directly (unit tests) rather than executing queries
- Group related tests in `describe` blocks
- Test both positive cases and error conditions
- Use meaningful test names that describe expected behavior

### DON'T
- Don't require actual DuckDB-WASM initialization for unit tests
- Don't test IndexedDB storage in QueryBuilder tests (mock it)
- Don't modify the existing QueryBuilder implementation
- Don't create integration tests that require browser environment

## Development Environment

### Start Services

```bash
# Install dependencies
npm install

# Run tests for engine-browser package
cd packages/engine-browser
npm run test

# Run all tests from root
npx turbo run test
```

### Service URLs
- N/A (library package, no server)

### Required Environment Variables
- None required for testing

## Success Criteria

The task is complete when:

1. [ ] `packages/engine-browser/src/query-builder.test.ts` exists with comprehensive tests
2. [ ] All QueryBuilder public methods have test coverage
3. [ ] SQL generation produces correct output for all clause types
4. [ ] Edge cases are tested (empty operations, null values, special characters)
5. [ ] Immutability is verified (chainable methods return new instances)
6. [ ] No console errors during test execution
7. [ ] All tests pass with `npm run test`
8. [ ] Test file follows existing project patterns

## QA Acceptance Criteria

**CRITICAL**: These criteria must be verified by the QA Agent before sign-off.

### Unit Tests
| Test | File | What to Verify |
|------|------|----------------|
| Filter operations | `query-builder.test.ts` | `filter()` correctly adds predicates to operations |
| Sort operations | `query-builder.test.ts` | `sort()` and `orderBy()` correctly add sort orders |
| GroupBy operations | `query-builder.test.ts` | `groupBy()` correctly adds group columns and aggregations |
| Join operations | `query-builder.test.ts` | `join()` correctly adds join configuration |
| Limit/Offset | `query-builder.test.ts` | `limit()` and `offset()` correctly add constraints |
| Select columns | `query-builder.test.ts` | `select()` correctly specifies columns |
| SQL generation | `query-builder.test.ts` | `sql()` produces valid SQL strings |
| Batch query | `query-builder.test.ts` | `batchQuery()` combines queries correctly |
| Helper functions | `query-builder.test.ts` | `formatPredicate`, `buildPlan`, etc. work correctly |

### Integration Tests
| Test | Services | What to Verify |
|------|----------|----------------|
| N/A | N/A | Unit tests only for this task |

### End-to-End Tests
| Flow | Steps | Expected Outcome |
|------|-------|------------------|
| N/A | N/A | Unit tests only for this task |

### Browser Verification (if frontend)
| Page/Component | URL | Checks |
|----------------|-----|--------|
| N/A | N/A | Library package - no UI |

### Database Verification (if applicable)
| Check | Query/Command | Expected |
|-------|---------------|----------|
| N/A | N/A | Tests use mocked connections |

### Test Coverage Requirements
| Area | Minimum Coverage | Verification |
|------|------------------|--------------|
| QueryBuilder class | 80% line coverage | `npm run test -- --coverage` |
| Public methods | 100% | All public methods called in tests |
| Edge cases | All documented | Edge cases section above |

### QA Sign-off Requirements
- [ ] All unit tests pass
- [ ] All integration tests pass (N/A)
- [ ] All E2E tests pass (N/A)
- [ ] Browser verification complete (N/A)
- [ ] Database state verified (N/A - mocked)
- [ ] No regressions in existing functionality
- [ ] Code follows established patterns from connector-csv tests
- [ ] No security vulnerabilities introduced
- [ ] Test file is properly typed with TypeScript
- [ ] Mocks are properly typed and realistic

## Appendix: QueryBuilder Method Reference

### Chainable Query Methods
```typescript
filter(predicates: FilterPredicateLocal[]): QueryBuilder
sort(orders: SortOrderLocal[]): QueryBuilder
orderBy(orders: SortOrderLocal[]): QueryBuilder  // alias for sort
groupBy(columns: string[], aggregations?: AggregationLocal[]): QueryBuilder
join(other: DataFrame, options: JoinOptionsLocal): QueryBuilder
limit(count: number): QueryBuilder
offset(count: number): QueryBuilder
select(columns: string[]): QueryBuilder
```

### Execution Methods
```typescript
sql(): Promise<string>
toSQL(): Promise<string>  // alias for sql
rows(): Promise<Record<string, unknown>[]>
run(): Promise<BrowserDataFrame>
preview(limit?: number): Promise<Record<string, unknown>[]>
count(): Promise<number>
```

### Static Methods
```typescript
static batchQuery<T>(conn: AsyncDuckDBConnection, queries: string[]): Promise<T[][]>
```

### Types to Test
```typescript
type FilterPredicateLocal = {
  columnName: string;
  operator: string;
  value?: unknown;
  values?: unknown[];
};

type SortOrderLocal = {
  columnName: string;
  direction: "asc" | "desc";
};

type AggregationLocal = {
  columnName: string;
  function: string;
  alias?: string;
};

type JoinOptionsLocal = {
  type: "inner" | "left" | "right" | "outer";
  leftColumn: string;
  rightColumn: string;
};
```
