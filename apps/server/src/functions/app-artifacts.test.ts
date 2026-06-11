/**
 * Tests for the privacy-floor write boundary in app-artifacts.
 *
 * Contract: any DataFrameAnalysis written through putDataFrameEntry or
 * updateDataFrameEntry lands in the artifact DB with zero raw sampleValues.
 * The invariant is structural — it cannot be broken by the caller passing
 * sampleValues, because the boundary strips them before every write.
 *
 * Pattern matches commands.test.ts: real PGLite, 'should ...' names,
 * structural-invariant testing.
 */
import { openArtifactDb, schema } from "@dashframe/server-core";
import type { DataFrameAnalysis } from "@dashframe/types";
import { createWyStack, type WyStackApp } from "@wystack/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { functions } from "../functions";

const { dataFrames } = schema;

// A DataFrameAnalysis with raw sampleValues — simulates what analyzeDataFrame
// returns in memory before the privacy boundary strips it.
function makeAnalysisWithSamples(): DataFrameAnalysis {
  return {
    rowCount: 3,
    analyzedAt: Date.now(),
    fieldHash: "test-hash",
    columns: [
      {
        columnName: "email",
        dataType: "string",
        semantic: "email",
        cardinality: 3,
        uniqueness: 1,
        nullCount: 0,
        sampleValues: ["alice@example.com", "bob@example.com"],
        minLength: 15,
        maxLength: 17,
        avgLength: 16,
      },
      {
        columnName: "age",
        dataType: "number",
        semantic: "numerical",
        cardinality: 3,
        uniqueness: 1,
        nullCount: 0,
        sampleValues: [25, 31, 47],
        min: 25,
        max: 47,
      },
    ],
  };
}

function makeDataFrameEntry(id: string, analysis?: DataFrameAnalysis) {
  return {
    id,
    storage: { type: "indexeddb" as const, key: `arrow-${id}` },
    fieldIds: [],
    primaryKey: undefined,
    createdAt: Date.now(),
    name: "Test Frame",
    insightId: undefined,
    rowCount: 3,
    columnCount: 2,
    analysis,
  };
}

describe("privacy floor — no raw sampleValues persist in artifact DB", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: WyStackApp;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-artifacts-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    app = await createWyStack({ db, functions });
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function readAnalysis(id: string): Promise<DataFrameAnalysis | null> {
    const rows = await db.select().from(dataFrames);
    const row = rows.find((r) => r.id === id);
    return (row?.analysis as DataFrameAnalysis | null | undefined) ?? null;
  }

  async function call(path: string, args: unknown): Promise<unknown> {
    const { result } = await app.call(path, args);
    return result;
  }

  it("should strip sampleValues when writing analysis via putDataFrameEntry", async () => {
    const id = crypto.randomUUID();
    const analysis = makeAnalysisWithSamples();

    await call("putDataFrameEntry", {
      entry: makeDataFrameEntry(id, analysis),
    });

    const stored = await readAnalysis(id);
    expect(stored).not.toBeNull();
    // Every column must have an empty sampleValues array — never raw values.
    for (const col of stored!.columns) {
      expect(col.sampleValues).toEqual([]);
    }
    // Profile fields must still be present and correct.
    const emailCol = stored!.columns.find((c) => c.columnName === "email");
    expect(emailCol?.cardinality).toBe(3);
    expect(emailCol?.semantic).toBe("email");
  });

  it("should strip sampleValues when updating analysis via updateDataFrameEntry", async () => {
    const id = crypto.randomUUID();
    // Insert a frame without analysis first.
    await call("putDataFrameEntry", { entry: makeDataFrameEntry(id) });

    // Now update with an analysis that carries raw sampleValues.
    const analysis = makeAnalysisWithSamples();
    await call("updateDataFrameEntry", { id, updates: { analysis } });

    const stored = await readAnalysis(id);
    expect(stored).not.toBeNull();
    for (const col of stored!.columns) {
      expect(col.sampleValues).toEqual([]);
    }
    // Numeric profile stats survive the strip.
    const ageCol = stored!.columns.find((c) => c.columnName === "age");
    expect(ageCol?.dataType).toBe("number");
    if (ageCol?.dataType === "number") {
      expect(ageCol.min).toBe(25);
      expect(ageCol.max).toBe(47);
    }
  });

  it("should store profiles intact when analysis has no sampleValues", async () => {
    const id = crypto.randomUUID();
    // Analysis already clean (sampleValues: []).
    const cleanAnalysis: DataFrameAnalysis = {
      rowCount: 10,
      analyzedAt: Date.now(),
      fieldHash: "hash",
      columns: [
        {
          columnName: "country",
          dataType: "string",
          semantic: "categorical",
          cardinality: 5,
          uniqueness: 0.5,
          nullCount: 0,
          sampleValues: [],
        },
      ],
    };

    await call("putDataFrameEntry", {
      entry: makeDataFrameEntry(id, cleanAnalysis),
    });

    const stored = await readAnalysis(id);
    expect(stored?.columns[0]?.cardinality).toBe(5);
    expect(stored?.columns[0]?.sampleValues).toEqual([]);
  });

  it("should leave analysis null when none is provided", async () => {
    const id = crypto.randomUUID();
    await call("putDataFrameEntry", { entry: makeDataFrameEntry(id) });

    const stored = await readAnalysis(id);
    expect(stored).toBeNull();
  });
});
