/**
 * Unit tests for Notion converter
 *
 * Tests cover:
 * - Property value extraction for all Notion property types
 * - Type mapping from Notion to DataFrame
 * - Data conversion from Notion to DataFrame format
 */
import type { Field } from "@dashframe/engine";
import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import { tableFromIPC } from "apache-arrow";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  convertNotionToDataFrame,
  extractPropertyValue,
  mapNotionTypeToColumnType,
} from "./converter";

// ============================================================================
// Test Fixtures
// ============================================================================

function createField(name: string, options: Partial<Field> = {}): Field {
  return {
    id: crypto.randomUUID(),
    name,
    type: "string",
    columnName: name,
    ...options,
  };
}

// ============================================================================
// Type Mapping Tests
// ============================================================================

describe("mapNotionTypeToColumnType", () => {
  it("should map number to number", () => {
    expect(mapNotionTypeToColumnType("number")).toBe("number");
  });

  it("should map date to date", () => {
    expect(mapNotionTypeToColumnType("date")).toBe("date");
  });

  it("should map checkbox to boolean", () => {
    expect(mapNotionTypeToColumnType("checkbox")).toBe("boolean");
  });

  it("should map text types to string", () => {
    expect(mapNotionTypeToColumnType("title")).toBe("string");
    expect(mapNotionTypeToColumnType("rich_text")).toBe("string");
    expect(mapNotionTypeToColumnType("select")).toBe("string");
    expect(mapNotionTypeToColumnType("multi_select")).toBe("string");
    expect(mapNotionTypeToColumnType("url")).toBe("string");
    expect(mapNotionTypeToColumnType("email")).toBe("string");
    expect(mapNotionTypeToColumnType("phone_number")).toBe("string");
    expect(mapNotionTypeToColumnType("status")).toBe("string");
  });
});

// ============================================================================
// Property Value Extraction Tests
// ============================================================================

type PropertyValue = PageObjectResponse["properties"][string];

function text(content: string) {
  return {
    type: "text" as const,
    text: { content, link: null },
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      color: "default" as const,
    },
    plain_text: content,
    href: null,
  };
}

const notionDate = (start: string) => ({ start, end: null, time_zone: null });

describe("extractPropertyValue", () => {
  it.each<[string, PropertyValue, unknown]>([
    [
      "concatenates multiple title segments",
      { id: "title", type: "title", title: [text("Part 1 "), text("Part 2")] },
      "Part 1 Part 2",
    ],
    [
      "returns null for empty title",
      { id: "title", type: "title", title: [] },
      null,
    ],
    [
      "extracts rich text content",
      {
        id: "description",
        type: "rich_text",
        rich_text: [text("Description text")],
      },
      "Description text",
    ],
    [
      "returns null for empty rich text",
      { id: "description", type: "rich_text", rich_text: [] },
      null,
    ],
    [
      "extracts number value",
      { id: "amount", type: "number", number: 42.5 },
      42.5,
    ],
    [
      "extracts select value name",
      {
        id: "status",
        type: "select",
        select: { id: "1", name: "Active", color: "green" },
      },
      "Active",
    ],
    [
      "returns null for null select",
      { id: "status", type: "select", select: null },
      null,
    ],
    [
      "extracts and joins multi select values",
      {
        id: "tags",
        type: "multi_select",
        multi_select: [
          { id: "1", name: "tag1", color: "blue" },
          { id: "2", name: "tag2", color: "green" },
        ],
      },
      "tag1, tag2",
    ],
    [
      "returns null for empty multi select",
      { id: "tags", type: "multi_select", multi_select: [] },
      null,
    ],
    [
      "extracts date start value",
      { id: "created", type: "date", date: notionDate("2024-01-15") },
      "2024-01-15",
    ],
    [
      "returns null for null date",
      { id: "created", type: "date", date: null },
      null,
    ],
    [
      "extracts checkbox value (false)",
      { id: "completed", type: "checkbox", checkbox: false },
      false,
    ],
    [
      "extracts URL value",
      { id: "website", type: "url", url: "https://example.com" },
      "https://example.com",
    ],
    [
      "extracts email value",
      { id: "contact", type: "email", email: "user@example.com" },
      "user@example.com",
    ],
    [
      "extracts phone number",
      { id: "phone", type: "phone_number", phone_number: "+1-555-1234" },
      "+1-555-1234",
    ],
    [
      "extracts status name",
      {
        id: "workflow",
        type: "status",
        status: { id: "1", name: "In Progress", color: "yellow" },
      },
      "In Progress",
    ],
    [
      "returns null for null status",
      { id: "workflow", type: "status", status: null },
      null,
    ],
    [
      "extracts created time",
      {
        id: "created",
        type: "created_time",
        created_time: "2024-01-15T10:00:00.000Z",
      },
      "2024-01-15T10:00:00.000Z",
    ],
    [
      "extracts last edited time",
      {
        id: "modified",
        type: "last_edited_time",
        last_edited_time: "2024-01-16T15:30:00.000Z",
      },
      "2024-01-16T15:30:00.000Z",
    ],
    [
      "extracts and joins people names",
      {
        id: "assignees",
        type: "people",
        people: [
          {
            object: "user",
            id: "user-1",
            name: "Alice",
            avatar_url: null,
            type: "person",
            person: { email: "alice@example.com" },
          },
          {
            object: "user",
            id: "user-2",
            name: "Bob",
            avatar_url: null,
            type: "person",
            person: { email: "bob@example.com" },
          },
        ],
      },
      "Alice, Bob",
    ],
    [
      "uses the ID when a person's name is missing",
      {
        id: "assignees",
        type: "people",
        people: [
          {
            object: "user",
            id: "user-1",
            avatar_url: null,
            type: "bot",
            bot: {},
          },
        ],
      },
      "user-1",
    ],
    [
      "returns null for empty people",
      { id: "assignees", type: "people", people: [] },
      null,
    ],
    [
      "extracts and joins file names",
      {
        id: "attachments",
        type: "files",
        files: [
          {
            name: "document.pdf",
            type: "file",
            file: {
              url: "https://example.com/document.pdf",
              expiry_time: "2024-12-31T00:00:00.000Z",
            },
          },
          {
            name: "image.png",
            type: "external",
            external: { url: "https://example.com/image.png" },
          },
        ],
      },
      "document.pdf, image.png",
    ],
    [
      "returns null for empty files",
      { id: "attachments", type: "files", files: [] },
      null,
    ],
    [
      "extracts and joins relation IDs",
      {
        id: "related",
        type: "relation",
        relation: [{ id: "page-1" }, { id: "page-2" }],
        has_more: false,
      },
      "page-1, page-2",
    ],
    [
      "returns null for empty relation",
      { id: "related", type: "relation", relation: [], has_more: false },
      null,
    ],
    [
      "extracts string formula result",
      {
        id: "calculated",
        type: "formula",
        formula: { type: "string", string: "Result" },
      },
      "Result",
    ],
    [
      "extracts number formula result",
      {
        id: "calculated",
        type: "formula",
        formula: { type: "number", number: 123 },
      },
      123,
    ],
    [
      "extracts boolean formula result",
      {
        id: "calculated",
        type: "formula",
        formula: { type: "boolean", boolean: true },
      },
      true,
    ],
    [
      "extracts date formula result",
      {
        id: "calculated",
        type: "formula",
        formula: { type: "date", date: notionDate("2024-01-15") },
      },
      "2024-01-15",
    ],
    [
      "returns null for null date formula",
      {
        id: "calculated",
        type: "formula",
        formula: { type: "date", date: null },
      },
      null,
    ],
    [
      "extracts number rollup result",
      {
        id: "sum",
        type: "rollup",
        rollup: { type: "number", number: 456, function: "sum" },
      },
      456,
    ],
    [
      "extracts date rollup result",
      {
        id: "latest",
        type: "rollup",
        rollup: {
          type: "date",
          date: notionDate("2024-01-20"),
          function: "latest_date",
        },
      },
      "2024-01-20",
    ],
    [
      "returns array length for array rollup",
      {
        id: "items",
        type: "rollup",
        rollup: {
          type: "array",
          array: [
            { type: "number", number: 1 },
            { type: "number", number: 2 },
          ],
          function: "show_original",
        },
      },
      2,
    ],
  ])("%s", (_label, property, expected) => {
    expect(extractPropertyValue(property)).toBe(expected);
  });

  it("should return null for null property", () => {
    // @ts-expect-error - Testing runtime validation
    expect(extractPropertyValue(null)).toBeNull();
  });
});

// ============================================================================
// Full Conversion Tests
// ============================================================================

function page(id: string, properties: PageObjectResponse["properties"] = {}) {
  return {
    object: "page" as const,
    id,
    created_time: "2024-01-15T00:00:00.000Z",
    last_edited_time: "2024-01-15T00:00:00.000Z",
    created_by: { object: "user" as const, id: "user-1" },
    last_edited_by: { object: "user" as const, id: "user-1" },
    cover: null,
    icon: null,
    parent: { type: "database_id" as const, database_id: "db-1" },
    archived: false,
    in_trash: false,
    properties,
    url: `https://notion.so/${id}`,
    public_url: null,
  };
}

function listOf(...results: unknown[]) {
  return {
    object: "list" as const,
    results: results as PageObjectResponse[],
    next_cursor: null,
    has_more: false,
    type: "page_or_database" as const,
    page_or_database: {},
    request_id: "req-1",
  };
}

describe("convertNotionToDataFrame", () => {
  let fields: Field[];

  beforeEach(() => {
    fields = [
      createField("_notionId", { type: "string" }),
      createField("Name", { columnName: "Name" }),
      createField("Status", { columnName: "Status" }),
      createField("Count", { columnName: "Count", type: "number" }),
    ];
  });

  it("should convert Notion pages to DataFrame format", () => {
    const response = listOf(
      page("page-1", {
        Name: { id: "title", type: "title", title: [text("Test Item")] },
        Status: {
          id: "status",
          type: "select",
          select: { id: "1", name: "Active", color: "green" },
        },
        Count: { id: "count", type: "number", number: 42 },
      }),
    );

    const result = convertNotionToDataFrame(response, fields);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({
      _notionId: "page-1",
      Name: "Test Item",
      Status: "Active",
      Count: 42,
    });
    expect(result.fieldIds).toEqual(fields.map((f) => f.id));
  });

  it("should generate correct column definitions", () => {
    const result = convertNotionToDataFrame(listOf(), fields);

    expect(result.columns).toEqual([
      { name: "Name", type: "string" },
      { name: "Status", type: "string" },
      { name: "Count", type: "number" },
    ]);
  });

  it("should filter out non-page results", () => {
    const response = listOf({ object: "database", id: "db-1" }, page("page-1"));

    const result = convertNotionToDataFrame(response, fields);

    expect(result.rowCount).toBe(1);
    expect(result.rows[0]._notionId).toBe("page-1");
  });

  // ============================================================================
  // Data-corruption regression: missing-key rows must not silently corrupt
  // ============================================================================

  describe("missing-key rows must produce explicit nulls — not silent NaN/undefined", () => {
    it("populates null for fields whose columnName is absent from page.properties", () => {
      // Only 'Name' is present; 'Status' and 'Count' are missing from the page.
      const response = listOf(
        page("page-sparse", {
          Name: { id: "title", type: "title", title: [text("Sparse")] },
        }),
      );

      const result = convertNotionToDataFrame(response, fields);

      const row = result.rows[0];
      expect(row).toBeDefined();

      // Missing fields must be null, never undefined or NaN
      expect(row!.Status).toBeNull();
      expect(row!.Count).toBeNull();

      // Present field and computed _notionId must still be correct
      expect(row!._notionId).toBe("page-sparse");
      expect(row!.Name).toBe("Sparse");

      // Key presence: every field name must be an own key (Arrow needs it)
      expect(Object.hasOwn(row, "Status")).toBe(true);
      expect(Object.hasOwn(row, "Count")).toBe(true);
    });

    it("row has exactly as many keys as there are fields (no extras, no missing)", () => {
      const result = convertNotionToDataFrame(
        listOf(page("page-check")),
        fields,
      );
      const row = result.rows[0];

      // Exactly fields.length keys — no extras, no missing
      expect(Object.keys(row!)).toHaveLength(fields.length);
      for (const field of fields) {
        expect(Object.hasOwn(row, field.name)).toBe(true);
      }
    });

    it("all-missing-properties page serialises cleanly to Arrow without throwing", () => {
      const response = listOf(page("page-empty"));

      // Must not throw — all missing fields become explicit null, Arrow can encode them
      expect(() => convertNotionToDataFrame(response, fields)).not.toThrow();

      const result = convertNotionToDataFrame(response, fields);
      // Decode and re-parse — tableFromIPC throws on a corrupt IPC buffer
      expect(typeof result.arrowBuffer).toBe("string");
      const decoded = Buffer.from(result.arrowBuffer, "base64");
      expect(() => tableFromIPC(decoded)).not.toThrow();
    });

    it("throws loudly when the fields schema contains duplicate field names", () => {
      // Duplicate field names would collapse into one key in Object.fromEntries,
      // producing a row with fewer columns than fields — detect this at schema
      // validation time, not silently.
      const dupFields = [
        createField("Name", { columnName: "Name" }),
        createField("Name", { columnName: "AnotherColumn" }), // duplicate name
        createField("Count", { columnName: "Count", type: "number" }),
      ];

      expect(() => convertNotionToDataFrame(listOf(), dupFields)).toThrow(
        /duplicate field name/i,
      );
    });
  });
});
