/**
 * Unit tests for Notion converter
 *
 * Tests cover:
 * - Property value extraction for all Notion property types
 * - Type mapping from Notion to DataFrame
 * - Data conversion from Notion to DataFrame format
 */
import type { Field } from "@dashframe/engine-browser";
import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import { beforeEach, describe, expect, it } from "vitest";
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

  it("should map time types to string", () => {
    expect(mapNotionTypeToColumnType("created_time")).toBe("string");
    expect(mapNotionTypeToColumnType("last_edited_time")).toBe("string");
  });

  it("should default unknown types to string", () => {
    expect(mapNotionTypeToColumnType("unknown_type")).toBe("string");
    expect(mapNotionTypeToColumnType("formula")).toBe("string");
    expect(mapNotionTypeToColumnType("rollup")).toBe("string");
  });
});

// ============================================================================
// Property Value Extraction Tests
// ============================================================================

describe("extractPropertyValue", () => {
  describe("title property", () => {
    it("should extract title text", () => {
      const property = {
        id: "title",
        type: "title" as const,
        title: [
          {
            type: "text" as const,
            text: { content: "Test Page", link: null },
            annotations: {
              bold: false,
              italic: false,
              strikethrough: false,
              underline: false,
              code: false,
              color: "default" as const,
            },
            plain_text: "Test Page",
            href: null,
          },
        ],
      };

      expect(extractPropertyValue(property)).toBe("Test Page");
    });

    it("should concatenate multiple title segments", () => {
      const property = {
        id: "title",
        type: "title" as const,
        title: [
          {
            type: "text" as const,
            text: { content: "Part 1 ", link: null },
            annotations: {
              bold: false,
              italic: false,
              strikethrough: false,
              underline: false,
              code: false,
              color: "default" as const,
            },
            plain_text: "Part 1 ",
            href: null,
          },
          {
            type: "text" as const,
            text: { content: "Part 2", link: null },
            annotations: {
              bold: false,
              italic: false,
              strikethrough: false,
              underline: false,
              code: false,
              color: "default" as const,
            },
            plain_text: "Part 2",
            href: null,
          },
        ],
      };

      expect(extractPropertyValue(property)).toBe("Part 1 Part 2");
    });

    it("should return null for empty title", () => {
      const property = {
        id: "title",
        type: "title" as const,
        title: [],
      };

      expect(extractPropertyValue(property)).toBeNull();
    });
  });

  describe("rich_text property", () => {
    it("should extract rich text content", () => {
      const property = {
        id: "description",
        type: "rich_text" as const,
        rich_text: [
          {
            type: "text" as const,
            text: { content: "Description text", link: null },
            annotations: {
              bold: false,
              italic: false,
              strikethrough: false,
              underline: false,
              code: false,
              color: "default" as const,
            },
            plain_text: "Description text",
            href: null,
          },
        ],
      };

      expect(extractPropertyValue(property)).toBe("Description text");
    });

    it("should return null for empty rich text", () => {
      const property = {
        id: "description",
        type: "rich_text" as const,
        rich_text: [],
      };

      expect(extractPropertyValue(property)).toBeNull();
    });
  });

  describe("number property", () => {
    it("should extract number value", () => {
      const property = {
        id: "amount",
        type: "number" as const,
        number: 42.5,
      };

      expect(extractPropertyValue(property)).toBe(42.5);
    });

    it("should return null for null number", () => {
      const property = {
        id: "amount",
        type: "number" as const,
        number: null,
      };

      expect(extractPropertyValue(property)).toBeNull();
    });
  });

  describe("select property", () => {
    it("should extract select value name", () => {
      const property = {
        id: "status",
        type: "select" as const,
        select: {
          id: "1",
          name: "Active",
          color: "green" as const,
        },
      };

      expect(extractPropertyValue(property)).toBe("Active");
    });

    it("should return null for null select", () => {
      const property = {
        id: "status",
        type: "select" as const,
        select: null,
      };

      expect(extractPropertyValue(property)).toBeNull();
    });
  });

  describe("multi_select property", () => {
    it("should extract and join multi select values", () => {
      const property = {
        id: "tags",
        type: "multi_select" as const,
        multi_select: [
          { id: "1", name: "tag1", color: "blue" as const },
          { id: "2", name: "tag2", color: "green" as const },
        ],
      };

      expect(extractPropertyValue(property)).toBe("tag1, tag2");
    });

    it("should return null for empty multi select", () => {
      const property = {
        id: "tags",
        type: "multi_select" as const,
        multi_select: [],
      };

      expect(extractPropertyValue(property)).toBeNull();
    });
  });

  describe("date property", () => {
    it("should extract date start value", () => {
      const property = {
        id: "created",
        type: "date" as const,
        date: {
          start: "2024-01-15",
          end: null,
          time_zone: null,
        },
      };

      expect(extractPropertyValue(property)).toBe("2024-01-15");
    });

    it("should return null for null date", () => {
      const property = {
        id: "created",
        type: "date" as const,
        date: null,
      };

      expect(extractPropertyValue(property)).toBeNull();
    });
  });

  describe("checkbox property", () => {
    it("should extract checkbox value (true)", () => {
      const property = {
        id: "completed",
        type: "checkbox" as const,
        checkbox: true,
      };

      expect(extractPropertyValue(property)).toBe(true);
    });

    it("should extract checkbox value (false)", () => {
      const property = {
        id: "completed",
        type: "checkbox" as const,
        checkbox: false,
      };

      expect(extractPropertyValue(property)).toBe(false);
    });
  });

  describe("url property", () => {
    it("should extract URL value", () => {
      const property = {
        id: "website",
        type: "url" as const,
        url: "https://example.com",
      };

      expect(extractPropertyValue(property)).toBe("https://example.com");
    });

    it("should return null for null URL", () => {
      const property = {
        id: "website",
        type: "url" as const,
        url: null,
      };

      expect(extractPropertyValue(property)).toBeNull();
    });
  });

  describe("email property", () => {
    it("should extract email value", () => {
      const property = {
        id: "contact",
        type: "email" as const,
        email: "user@example.com",
      };

      expect(extractPropertyValue(property)).toBe("user@example.com");
    });

    it("should return null for null email", () => {
      const property = {
        id: "contact",
        type: "email" as const,
        email: null,
      };

      expect(extractPropertyValue(property)).toBeNull();
    });
  });

  describe("phone_number property", () => {
    it("should extract phone number", () => {
      const property = {
        id: "phone",
        type: "phone_number" as const,
        phone_number: "+1-555-1234",
      };

      expect(extractPropertyValue(property)).toBe("+1-555-1234");
    });

    it("should return null for null phone number", () => {
      const property = {
        id: "phone",
        type: "phone_number" as const,
        phone_number: null,
      };

      expect(extractPropertyValue(property)).toBeNull();
    });
  });

  describe("status property", () => {
    it("should extract status name", () => {
      const property = {
        id: "workflow",
        type: "status" as const,
        status: {
          id: "1",
          name: "In Progress",
          color: "yellow" as const,
        },
      };

      expect(extractPropertyValue(property)).toBe("In Progress");
    });

    it("should return null for null status", () => {
      const property = {
        id: "workflow",
        type: "status" as const,
        status: null,
      };

      expect(extractPropertyValue(property)).toBeNull();
    });
  });

  describe("created_time property", () => {
    it("should extract created time", () => {
      const property = {
        id: "created",
        type: "created_time" as const,
        created_time: "2024-01-15T10:00:00.000Z",
      };

      expect(extractPropertyValue(property)).toBe("2024-01-15T10:00:00.000Z");
    });
  });

  describe("last_edited_time property", () => {
    it("should extract last edited time", () => {
      const property = {
        id: "modified",
        type: "last_edited_time" as const,
        last_edited_time: "2024-01-16T15:30:00.000Z",
      };

      expect(extractPropertyValue(property)).toBe("2024-01-16T15:30:00.000Z");
    });
  });

  describe("people property", () => {
    it("should extract and join people names", () => {
      const property = {
        id: "assignees",
        type: "people" as const,
        people: [
          {
            object: "user" as const,
            id: "user-1",
            name: "Alice",
            avatar_url: null,
            type: "person" as const,
            person: { email: "alice@example.com" },
          },
          {
            object: "user" as const,
            id: "user-2",
            name: "Bob",
            avatar_url: null,
            type: "person" as const,
            person: { email: "bob@example.com" },
          },
        ],
      };

      expect(extractPropertyValue(property)).toBe("Alice, Bob");
    });

    it("should use ID when name is missing", () => {
      const property = {
        id: "assignees",
        type: "people" as const,
        people: [
          {
            object: "user" as const,
            id: "user-1",
            avatar_url: null,
            type: "bot" as const,
            bot: {},
          },
        ],
      };

      expect(extractPropertyValue(property)).toBe("user-1");
    });

    it("should return null for empty people", () => {
      const property = {
        id: "assignees",
        type: "people" as const,
        people: [],
      };

      expect(extractPropertyValue(property)).toBeNull();
    });
  });

  describe("files property", () => {
    it("should extract and join file names", () => {
      const property = {
        id: "attachments",
        type: "files" as const,
        files: [
          {
            name: "document.pdf",
            type: "file" as const,
            file: {
              url: "https://example.com/document.pdf",
              expiry_time: "2024-12-31T00:00:00.000Z",
            },
          },
          {
            name: "image.png",
            type: "external" as const,
            external: { url: "https://example.com/image.png" },
          },
        ],
      };

      expect(extractPropertyValue(property)).toBe("document.pdf, image.png");
    });

    it("should return null for empty files", () => {
      const property = {
        id: "attachments",
        type: "files" as const,
        files: [],
      };

      expect(extractPropertyValue(property)).toBeNull();
    });
  });

  describe("relation property", () => {
    it("should extract and join relation IDs", () => {
      const property = {
        id: "related",
        type: "relation" as const,
        relation: [{ id: "page-1" }, { id: "page-2" }],
        has_more: false,
      };

      expect(extractPropertyValue(property)).toBe("page-1, page-2");
    });

    it("should return null for empty relation", () => {
      const property = {
        id: "related",
        type: "relation" as const,
        relation: [],
        has_more: false,
      };

      expect(extractPropertyValue(property)).toBeNull();
    });
  });

  describe("formula property", () => {
    it("should extract string formula result", () => {
      const property = {
        id: "calculated",
        type: "formula" as const,
        formula: {
          type: "string" as const,
          string: "Result",
        },
      };

      expect(extractPropertyValue(property)).toBe("Result");
    });

    it("should extract number formula result", () => {
      const property = {
        id: "calculated",
        type: "formula" as const,
        formula: {
          type: "number" as const,
          number: 123,
        },
      };

      expect(extractPropertyValue(property)).toBe(123);
    });

    it("should extract boolean formula result", () => {
      const property = {
        id: "calculated",
        type: "formula" as const,
        formula: {
          type: "boolean" as const,
          boolean: true,
        },
      };

      expect(extractPropertyValue(property)).toBe(true);
    });

    it("should extract date formula result", () => {
      const property = {
        id: "calculated",
        type: "formula" as const,
        formula: {
          type: "date" as const,
          date: {
            start: "2024-01-15",
            end: null,
            time_zone: null,
          },
        },
      };

      expect(extractPropertyValue(property)).toBe("2024-01-15");
    });

    it("should return null for null date formula", () => {
      const property = {
        id: "calculated",
        type: "formula" as const,
        formula: {
          type: "date" as const,
          date: null,
        },
      };

      expect(extractPropertyValue(property)).toBeNull();
    });
  });

  describe("rollup property", () => {
    it("should extract number rollup result", () => {
      const property = {
        id: "sum",
        type: "rollup" as const,
        rollup: {
          type: "number" as const,
          number: 456,
          function: "sum" as const,
        },
      };

      expect(extractPropertyValue(property)).toBe(456);
    });

    it("should extract date rollup result", () => {
      const property = {
        id: "latest",
        type: "rollup" as const,
        rollup: {
          type: "date" as const,
          date: {
            start: "2024-01-20",
            end: null,
            time_zone: null,
          },
          function: "latest_date" as const,
        },
      };

      expect(extractPropertyValue(property)).toBe("2024-01-20");
    });

    it("should return array length for array rollup", () => {
      const property = {
        id: "items",
        type: "rollup" as const,
        rollup: {
          type: "array" as const,
          array: [
            { type: "number" as const, number: 1 },
            { type: "number" as const, number: 2 },
          ],
          function: "show_original" as const,
        },
      };

      expect(extractPropertyValue(property)).toBe(2);
    });

    it("should return 0 for empty array rollup", () => {
      const property = {
        id: "items",
        type: "rollup" as const,
        rollup: {
          type: "array" as const,
          array: [],
          function: "show_original" as const,
        },
      };

      expect(extractPropertyValue(property)).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("should return null for null property", () => {
      // @ts-expect-error - Testing runtime validation
      expect(extractPropertyValue(null)).toBeNull();
    });

    it("should return null for undefined property", () => {
      // @ts-expect-error - Testing runtime validation
      expect(extractPropertyValue(undefined)).toBeNull();
    });
  });
});

// ============================================================================
// Full Conversion Tests
// ============================================================================

describe("convertNotionToDataFrame", () => {
  let fields: Field[];

  beforeEach(() => {
    fields = [
      createField("_rowIndex", { type: "number" }),
      createField("_notionId", { type: "string" }),
      createField("Name", { columnName: "Name" }),
      createField("Status", { columnName: "Status" }),
      createField("Count", { columnName: "Count", type: "number" }),
    ];
  });

  it("should convert Notion pages to DataFrame format", () => {
    const response = {
      object: "list" as const,
      results: [
        {
          object: "page" as const,
          id: "page-1",
          created_time: "2024-01-15T00:00:00.000Z",
          last_edited_time: "2024-01-15T00:00:00.000Z",
          created_by: { object: "user" as const, id: "user-1" },
          last_edited_by: { object: "user" as const, id: "user-1" },
          cover: null,
          icon: null,
          parent: { type: "database_id" as const, database_id: "db-1" },
          archived: false,
          in_trash: false,
          properties: {
            Name: {
              id: "title",
              type: "title" as const,
              title: [
                {
                  type: "text" as const,
                  text: { content: "Test Item", link: null },
                  annotations: {
                    bold: false,
                    italic: false,
                    strikethrough: false,
                    underline: false,
                    code: false,
                    color: "default" as const,
                  },
                  plain_text: "Test Item",
                  href: null,
                },
              ],
            },
            Status: {
              id: "status",
              type: "select" as const,
              select: {
                id: "1",
                name: "Active",
                color: "green" as const,
              },
            },
            Count: {
              id: "count",
              type: "number" as const,
              number: 42,
            },
          },
          url: "https://notion.so/page-1",
          public_url: null,
        },
      ] as PageObjectResponse[],
      next_cursor: null,
      has_more: false,
      type: "page_or_database" as const,
      page_or_database: {},
      request_id: "req-1",
    };

    const result = convertNotionToDataFrame(response, fields);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({
      _rowIndex: 0,
      _notionId: "page-1",
      Name: "Test Item",
      Status: "Active",
      Count: 42,
    });
  });

  it("should generate correct column definitions", () => {
    const response = {
      object: "list" as const,
      results: [],
      next_cursor: null,
      has_more: false,
      type: "page_or_database" as const,
      page_or_database: {},
      request_id: "req-1",
    };

    const result = convertNotionToDataFrame(response, fields);

    expect(result.columns).toEqual([
      { name: "Name", type: "string" },
      { name: "Status", type: "string" },
      { name: "Count", type: "number" },
    ]);
  });

  it("should encode Arrow buffer as base64", () => {
    const response = {
      object: "list" as const,
      results: [],
      next_cursor: null,
      has_more: false,
      type: "page_or_database" as const,
      page_or_database: {},
      request_id: "req-1",
    };

    const result = convertNotionToDataFrame(response, fields);

    expect(result.arrowBuffer).toBeDefined();
    expect(typeof result.arrowBuffer).toBe("string");
    // Base64 string should be valid
    expect(() => Buffer.from(result.arrowBuffer, "base64")).not.toThrow();
  });

  it("should return field IDs", () => {
    const response = {
      object: "list" as const,
      results: [],
      next_cursor: null,
      has_more: false,
      type: "page_or_database" as const,
      page_or_database: {},
      request_id: "req-1",
    };

    const result = convertNotionToDataFrame(response, fields);

    expect(result.fieldIds).toHaveLength(5);
    expect(result.fieldIds.every((id) => typeof id === "string")).toBe(true);
  });

  it("should return correct row count", () => {
    const response = {
      object: "list" as const,
      results: [
        {
          object: "page" as const,
          id: "page-1",
          created_time: "2024-01-15T00:00:00.000Z",
          last_edited_time: "2024-01-15T00:00:00.000Z",
          created_by: { object: "user" as const, id: "user-1" },
          last_edited_by: { object: "user" as const, id: "user-1" },
          cover: null,
          icon: null,
          parent: { type: "database_id" as const, database_id: "db-1" },
          archived: false,
          in_trash: false,
          properties: {
            Name: {
              id: "title",
              type: "title" as const,
              title: [],
            },
          },
          url: "https://notion.so/page-1",
          public_url: null,
        },
        {
          object: "page" as const,
          id: "page-2",
          created_time: "2024-01-15T00:00:00.000Z",
          last_edited_time: "2024-01-15T00:00:00.000Z",
          created_by: { object: "user" as const, id: "user-1" },
          last_edited_by: { object: "user" as const, id: "user-1" },
          cover: null,
          icon: null,
          parent: { type: "database_id" as const, database_id: "db-1" },
          archived: false,
          in_trash: false,
          properties: {
            Name: {
              id: "title",
              type: "title" as const,
              title: [],
            },
          },
          url: "https://notion.so/page-2",
          public_url: null,
        },
      ] as PageObjectResponse[],
      next_cursor: null,
      has_more: false,
      type: "page_or_database" as const,
      page_or_database: {},
      request_id: "req-1",
    };

    const result = convertNotionToDataFrame(response, fields);

    expect(result.rowCount).toBe(2);
  });

  it("should handle _rowIndex as computed field", () => {
    const response = {
      object: "list" as const,
      results: [
        {
          object: "page" as const,
          id: "page-1",
          created_time: "2024-01-15T00:00:00.000Z",
          last_edited_time: "2024-01-15T00:00:00.000Z",
          created_by: { object: "user" as const, id: "user-1" },
          last_edited_by: { object: "user" as const, id: "user-1" },
          cover: null,
          icon: null,
          parent: { type: "database_id" as const, database_id: "db-1" },
          archived: false,
          in_trash: false,
          properties: {},
          url: "https://notion.so/page-1",
          public_url: null,
        },
        {
          object: "page" as const,
          id: "page-2",
          created_time: "2024-01-15T00:00:00.000Z",
          last_edited_time: "2024-01-15T00:00:00.000Z",
          created_by: { object: "user" as const, id: "user-1" },
          last_edited_by: { object: "user" as const, id: "user-1" },
          cover: null,
          icon: null,
          parent: { type: "database_id" as const, database_id: "db-1" },
          archived: false,
          in_trash: false,
          properties: {},
          url: "https://notion.so/page-2",
          public_url: null,
        },
      ] as PageObjectResponse[],
      next_cursor: null,
      has_more: false,
      type: "page_or_database" as const,
      page_or_database: {},
      request_id: "req-1",
    };

    const result = convertNotionToDataFrame(response, fields);

    expect(result.rows[0]._rowIndex).toBe(0);
    expect(result.rows[1]._rowIndex).toBe(1);
  });

  it("should handle _notionId as computed field", () => {
    const response = {
      object: "list" as const,
      results: [
        {
          object: "page" as const,
          id: "page-123",
          created_time: "2024-01-15T00:00:00.000Z",
          last_edited_time: "2024-01-15T00:00:00.000Z",
          created_by: { object: "user" as const, id: "user-1" },
          last_edited_by: { object: "user" as const, id: "user-1" },
          cover: null,
          icon: null,
          parent: { type: "database_id" as const, database_id: "db-1" },
          archived: false,
          in_trash: false,
          properties: {},
          url: "https://notion.so/page-123",
          public_url: null,
        },
      ] as PageObjectResponse[],
      next_cursor: null,
      has_more: false,
      type: "page_or_database" as const,
      page_or_database: {},
      request_id: "req-1",
    };

    const result = convertNotionToDataFrame(response, fields);

    expect(result.rows[0]._notionId).toBe("page-123");
  });

  it("should filter out non-page results", () => {
    const response = {
      object: "list" as const,
      results: [
        {
          object: "database" as const,
          id: "db-1",
        },
        {
          object: "page" as const,
          id: "page-1",
          created_time: "2024-01-15T00:00:00.000Z",
          last_edited_time: "2024-01-15T00:00:00.000Z",
          created_by: { object: "user" as const, id: "user-1" },
          last_edited_by: { object: "user" as const, id: "user-1" },
          cover: null,
          icon: null,
          parent: { type: "database_id" as const, database_id: "db-1" },
          archived: false,
          in_trash: false,
          properties: {},
          url: "https://notion.so/page-1",
          public_url: null,
        },
      ] as PageObjectResponse[],
      next_cursor: null,
      has_more: false,
      type: "page_or_database" as const,
      page_or_database: {},
      request_id: "req-1",
    };

    const result = convertNotionToDataFrame(response, fields);

    expect(result.rowCount).toBe(1);
    expect(result.rows[0]._notionId).toBe("page-1");
  });

  it("should exclude _rowIndex from Arrow columns", () => {
    const response = {
      object: "list" as const,
      results: [],
      next_cursor: null,
      has_more: false,
      type: "page_or_database" as const,
      page_or_database: {},
      request_id: "req-1",
    };

    const result = convertNotionToDataFrame(response, fields);

    // _rowIndex should not be in columns
    expect(result.columns.find((c) => c.name === "_rowIndex")).toBeUndefined();
  });
});
