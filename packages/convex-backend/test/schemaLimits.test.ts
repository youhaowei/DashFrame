import { expect, it } from "vitest";
import schema from "../convex/schema";

const MAX_INDEXES_PER_TABLE = 32;
const MAX_INDEX_NAME_LENGTH = 64;
type ExportedSchema = {
  tables: {
    tableName: string;
    indexes: { indexDescriptor: string }[];
    stagedDbIndexes: { indexDescriptor: string }[];
    searchIndexes: { indexDescriptor: string }[];
    stagedSearchIndexes: { indexDescriptor: string }[];
    vectorIndexes: { indexDescriptor: string }[];
    stagedVectorIndexes: { indexDescriptor: string }[];
  }[];
};

it("keeps schema indexes within Convex deployment limits", () => {
  const exported = JSON.parse(
    (schema as unknown as { export(): string }).export(),
  ) as ExportedSchema;
  for (const table of exported.tables) {
    const indexes = [
      ...table.indexes,
      ...table.stagedDbIndexes,
      ...table.searchIndexes,
      ...table.stagedSearchIndexes,
      ...table.vectorIndexes,
      ...table.stagedVectorIndexes,
    ];
    expect(
      indexes.length,
      `${table.tableName} defines more than ${MAX_INDEXES_PER_TABLE} indexes`,
    ).toBeLessThanOrEqual(MAX_INDEXES_PER_TABLE);
    for (const index of indexes)
      expect(
        index.indexDescriptor.length,
        `${table.tableName}.${index.indexDescriptor} exceeds ${MAX_INDEX_NAME_LENGTH} characters`,
      ).toBeLessThanOrEqual(MAX_INDEX_NAME_LENGTH);
  }
});
