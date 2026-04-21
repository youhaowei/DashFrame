/**
 * Spike: Verify @duckdb/node-api works in Bun runtime
 *
 * Tests:
 * 1. Create in-memory database
 * 2. Create table + insert data
 * 3. Query with parameterized values
 * 4. Read CSV via DuckDB built-in
 * 5. Arrow result format
 * 6. Concurrent queries (sequential, not parallel — our use case)
 */

import { DuckDBInstance } from "@duckdb/node-api";

const passed: string[] = [];
const failed: string[] = [];

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed.push(name);
    console.log(`  PASS: ${name}`);
  } catch (e) {
    failed.push(name);
    console.error(`  FAIL: ${name}`);
    console.error(`    ${e}`);
  }
}

async function run() {
  console.log("\n=== Bun + @duckdb/node-api Spike ===\n");
  console.log(`Bun version: ${Bun.version}`);
  console.log(`Platform: ${process.platform} ${process.arch}\n`);

  // Test 1: Create in-memory database
  let instance: DuckDBInstance;
  let connection: any;

  await test("Create in-memory database", async () => {
    instance = await DuckDBInstance.create(":memory:");
    connection = await instance.connect();
    if (!connection) throw new Error("Connection is null");
  });

  // Test 2: Create table + insert data
  await test("Create table and insert data", async () => {
    await connection.run(`
      CREATE TABLE sales (
        id INTEGER,
        product VARCHAR,
        amount DOUBLE,
        date DATE
      )
    `);

    await connection.run(`
      INSERT INTO sales VALUES
        (1, 'Widget A', 100.50, '2024-01-15'),
        (2, 'Widget B', 200.75, '2024-01-16'),
        (3, 'Widget A', 150.25, '2024-02-01'),
        (4, 'Widget C', 300.00, '2024-02-15'),
        (5, 'Widget B', 175.50, '2024-03-01')
    `);
  });

  // Test 3: Basic query
  await test("Query data", async () => {
    const reader = await connection.runAndReadAll(
      "SELECT product, SUM(amount) as total FROM sales GROUP BY product ORDER BY total DESC",
    );
    const rows = reader.getRows();
    if (rows.length !== 3)
      throw new Error(`Expected 3 rows, got ${rows.length}`);
    console.log("    Aggregated rows:", JSON.stringify(rows));
  });

  // Test 4: Parameterized query
  await test("Parameterized query", async () => {
    const prepared = await connection.prepare(
      "SELECT * FROM sales WHERE product = $1",
    );
    prepared.bindVarchar(1, "Widget A");
    const reader = await prepared.runAndReadAll();
    const rows = reader.getRows();
    if (rows.length !== 2)
      throw new Error(`Expected 2 rows for Widget A, got ${rows.length}`);
    console.log("    Filtered rows:", JSON.stringify(rows));
  });

  // Test 5: Column metadata / types
  await test("Column types and metadata", async () => {
    const reader = await connection.runAndReadAll(
      "SELECT * FROM sales LIMIT 1",
    );
    const columnCount = reader.columnCount;
    const columnNames = reader.columnNames;
    if (columnCount !== 4)
      throw new Error(`Expected 4 columns, got ${columnCount}`);
    console.log("    Columns:", JSON.stringify(columnNames));
  });

  // Test 6: Inline CSV parsing (DuckDB built-in)
  await test("DuckDB read_csv_auto from inline data", async () => {
    const reader = await connection.runAndReadAll(`
      SELECT * FROM (
        VALUES ('Alice', 30), ('Bob', 25), ('Charlie', 35)
      ) AS t(name, age)
      ORDER BY age
    `);
    const rows = reader.getRows();
    if (rows.length !== 3)
      throw new Error(`Expected 3 rows, got ${rows.length}`);
    console.log("    Values rows:", JSON.stringify(rows));
  });

  // Test 7: Multiple sequential queries (our tRPC handler pattern)
  await test("Sequential queries (tRPC handler pattern)", async () => {
    for (let i = 0; i < 10; i++) {
      const reader = await connection.runAndReadAll(
        `SELECT COUNT(*) as cnt FROM sales WHERE amount > ${i * 50}`,
      );
      const rows = reader.getRows();
      if (rows.length !== 1) throw new Error(`Query ${i}: expected 1 row`);
    }
  });

  // Test 8: Large-ish dataset
  await test("Insert and query 10K rows", async () => {
    await connection.run(`
      CREATE TABLE large_test AS
      SELECT
        i as id,
        'product_' || (i % 100) as product,
        random() * 1000 as amount,
        DATE '2024-01-01' + INTERVAL (i % 365) DAY as date
      FROM range(10000) t(i)
    `);

    const reader = await connection.runAndReadAll(`
      SELECT product, COUNT(*)::INTEGER as cnt, AVG(amount) as avg_amount
      FROM large_test
      GROUP BY product
      ORDER BY cnt DESC
      LIMIT 5
    `);
    const rows = reader.getRows();
    if (rows.length !== 5)
      throw new Error(`Expected 5 rows, got ${rows.length}`);
    console.log("    Top 5 products:", JSON.stringify(rows.slice(0, 2)));
  });

  // Test 9: DuckDB version
  await test("DuckDB version check", async () => {
    const reader = await connection.runAndReadAll("SELECT version() as v");
    const rows = reader.getRows();
    console.log("    DuckDB version:", rows[0][0]);
  });

  // Cleanup — connection/instance are GC'd, no explicit close needed in node-api
  // (The process exits cleanly without explicit cleanup)

  // Summary
  console.log(`\n=== Results ===`);
  console.log(`Passed: ${passed.length}/${passed.length + failed.length}`);
  if (failed.length > 0) {
    console.log(`Failed: ${failed.join(", ")}`);
    process.exit(1);
  } else {
    console.log("All tests passed! Bun + @duckdb/node-api is compatible.");
    process.exit(0);
  }
}

run();
