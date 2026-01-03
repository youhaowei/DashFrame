/**
 * Unit tests for compute-combined-fields module
 *
 * Tests cover:
 * - computeCombinedFields() - Combined field computation for multi-table insights
 *   - Basic functionality (no joins, single join, multiple joins)
 *   - Column name collision handling with table prefixes
 *   - Internal field filtering (underscore prefix)
 *   - Display name generation for duplicates
 *   - Source table ID tracking
 *   - Table name shortening for prefixes
 *   - Edge cases (missing tables, empty fields, columnName vs name)
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Field, InsightJoinConfig, UUID } from "@dashframe/types";
import { computeCombinedFields } from "./compute-combined-fields";

describe("compute-combined-fields", () => {
  // ============================================================================
  // Mock Data Helpers
  // ============================================================================

  const createField = (overrides: Partial<Field> = {}): Field => ({
    id: "field123" as UUID,
    name: "field_name",
    type: "string",
    ...overrides,
  });

  const createDataTable = (
    id: string,
    name: string,
    fields: Field[],
    overrides: Partial<DataTable> = {},
  ): DataTable => ({
    id: id as UUID,
    name,
    fields,
    source: {
      type: "csv",
      config: {},
    },
    createdAt: Date.now(),
    ...overrides,
  });

  const createJoin = (
    rightTableId: string,
    leftKey = "id",
    rightKey = "id",
  ): InsightJoinConfig => ({
    type: "inner",
    rightTableId: rightTableId as UUID,
    leftKey,
    rightKey,
  });

  // ============================================================================
  // computeCombinedFields() - Basic Functionality
  // ============================================================================

  describe("computeCombinedFields() - basic functionality", () => {
    it("should return base table fields when no joins", () => {
      const fields = [
        createField({ id: "f1" as UUID, name: "name" }),
        createField({ id: "f2" as UUID, name: "email" }),
      ];
      const baseTable = createDataTable("table1", "Users", fields);

      const result = computeCombinedFields(baseTable, undefined, []);

      expect(result.count).toBe(2);
      expect(result.fields).toHaveLength(2);
      expect(result.fields[0].name).toBe("name");
      expect(result.fields[0].displayName).toBe("name");
      expect(result.fields[0].sourceTableId).toBe("table1");
      expect(result.fields[1].name).toBe("email");
      expect(result.fields[1].displayName).toBe("email");
      expect(result.fields[1].sourceTableId).toBe("table1");
    });

    it("should return base table fields when joins array is empty", () => {
      const fields = [createField({ id: "f1" as UUID, name: "product" })];
      const baseTable = createDataTable("table1", "Products", fields);

      const result = computeCombinedFields(baseTable, [], []);

      expect(result.count).toBe(1);
      expect(result.fields).toHaveLength(1);
      expect(result.fields[0].name).toBe("product");
      expect(result.fields[0].displayName).toBe("product");
    });

    it("should merge fields from base table and single joined table", () => {
      const baseFields = [
        createField({ id: "f1" as UUID, name: "user_id" }),
        createField({ id: "f2" as UUID, name: "user_name" }),
      ];
      const joinFields = [
        createField({ id: "f3" as UUID, name: "order_id" }),
        createField({ id: "f4" as UUID, name: "total" }),
      ];

      const baseTable = createDataTable("base", "Users", baseFields);
      const joinTable = createDataTable("join1", "Orders", joinFields);
      const joins = [createJoin("join1")];

      const result = computeCombinedFields(baseTable, joins, [baseTable, joinTable]);

      expect(result.count).toBe(4);
      expect(result.fields).toHaveLength(4);
      expect(result.fields[0].name).toBe("user_id");
      expect(result.fields[1].name).toBe("user_name");
      expect(result.fields[2].name).toBe("order_id");
      expect(result.fields[3].name).toBe("total");
    });

    it("should merge fields from base table and multiple joined tables", () => {
      const baseFields = [createField({ id: "f1" as UUID, name: "id" })];
      const join1Fields = [createField({ id: "f2" as UUID, name: "product" })];
      const join2Fields = [createField({ id: "f3" as UUID, name: "category" })];

      const baseTable = createDataTable("base", "Orders", baseFields);
      const joinTable1 = createDataTable("join1", "Products", join1Fields);
      const joinTable2 = createDataTable("join2", "Categories", join2Fields);
      const joins = [createJoin("join1"), createJoin("join2")];

      const result = computeCombinedFields(baseTable, joins, [
        baseTable,
        joinTable1,
        joinTable2,
      ]);

      expect(result.count).toBe(3);
      expect(result.fields).toHaveLength(3);
      expect(result.fields[0].sourceTableId).toBe("base");
      expect(result.fields[1].sourceTableId).toBe("join1");
      expect(result.fields[2].sourceTableId).toBe("join2");
    });

    it("should preserve all field properties from original fields", () => {
      const field = createField({
        id: "f1" as UUID,
        name: "revenue",
        type: "number",
        columnName: "total_revenue",
      });
      const baseTable = createDataTable("table1", "Sales", [field]);

      const result = computeCombinedFields(baseTable, undefined, []);

      expect(result.fields[0].id).toBe("f1");
      expect(result.fields[0].name).toBe("revenue");
      expect(result.fields[0].type).toBe("number");
      expect(result.fields[0].columnName).toBe("total_revenue");
    });
  });

  // ============================================================================
  // computeCombinedFields() - Column Name Collision Handling
  // ============================================================================

  describe("computeCombinedFields() - column name collision handling", () => {
    it("should prefix duplicate column names with table names", () => {
      const baseFields = [createField({ id: "f1" as UUID, name: "id" })];
      const joinFields = [createField({ id: "f2" as UUID, name: "id" })];

      const baseTable = createDataTable("base", "Users", baseFields);
      const joinTable = createDataTable("join1", "Orders", joinFields);
      const joins = [createJoin("join1")];

      const result = computeCombinedFields(baseTable, joins, [baseTable, joinTable]);

      expect(result.count).toBe(2);
      expect(result.fields[0].name).toBe("id");
      expect(result.fields[0].displayName).toBe("Users.id");
      expect(result.fields[1].name).toBe("id");
      expect(result.fields[1].displayName).toBe("Orders.id");
    });

    it("should use columnName for collision detection when available", () => {
      const baseFields = [
        createField({
          id: "f1" as UUID,
          name: "user_identifier",
          columnName: "id",
        }),
      ];
      const joinFields = [
        createField({
          id: "f2" as UUID,
          name: "order_identifier",
          columnName: "id",
        }),
      ];

      const baseTable = createDataTable("base", "Users", baseFields);
      const joinTable = createDataTable("join1", "Orders", joinFields);
      const joins = [createJoin("join1")];

      const result = computeCombinedFields(baseTable, joins, [baseTable, joinTable]);

      // Should detect collision based on columnName
      expect(result.fields[0].displayName).toBe("Users.user_identifier");
      expect(result.fields[1].displayName).toBe("Orders.order_identifier");
    });

    it("should not prefix non-duplicate column names", () => {
      const baseFields = [createField({ id: "f1" as UUID, name: "user_id" })];
      const joinFields = [createField({ id: "f2" as UUID, name: "order_id" })];

      const baseTable = createDataTable("base", "Users", baseFields);
      const joinTable = createDataTable("join1", "Orders", joinFields);
      const joins = [createJoin("join1")];

      const result = computeCombinedFields(baseTable, joins, [baseTable, joinTable]);

      // No duplicates, so no prefixing
      expect(result.fields[0].displayName).toBe("user_id");
      expect(result.fields[1].displayName).toBe("order_id");
    });

    it("should handle partial duplicates correctly", () => {
      const baseFields = [
        createField({ id: "f1" as UUID, name: "id" }),
        createField({ id: "f2" as UUID, name: "name" }),
      ];
      const joinFields = [
        createField({ id: "f3" as UUID, name: "id" }),
        createField({ id: "f4" as UUID, name: "total" }),
      ];

      const baseTable = createDataTable("base", "Users", baseFields);
      const joinTable = createDataTable("join1", "Orders", joinFields);
      const joins = [createJoin("join1")];

      const result = computeCombinedFields(baseTable, joins, [baseTable, joinTable]);

      expect(result.count).toBe(4);
      expect(result.fields[0].displayName).toBe("Users.id"); // Duplicate
      expect(result.fields[1].displayName).toBe("name"); // Not duplicate
      expect(result.fields[2].displayName).toBe("Orders.id"); // Duplicate
      expect(result.fields[3].displayName).toBe("total"); // Not duplicate
    });

    it("should handle case-insensitive column name collisions", () => {
      const baseFields = [createField({ id: "f1" as UUID, name: "ID" })];
      const joinFields = [createField({ id: "f2" as UUID, name: "id" })];

      const baseTable = createDataTable("base", "Users", baseFields);
      const joinTable = createDataTable("join1", "Orders", joinFields);
      const joins = [createJoin("join1")];

      const result = computeCombinedFields(baseTable, joins, [baseTable, joinTable]);

      // Should detect collision case-insensitively
      expect(result.fields[0].displayName).toBe("Users.ID");
      expect(result.fields[1].displayName).toBe("Orders.id");
    });

    it("should handle collisions across multiple joined tables", () => {
      const baseFields = [createField({ id: "f1" as UUID, name: "status" })];
      const join1Fields = [createField({ id: "f2" as UUID, name: "status" })];
      const join2Fields = [createField({ id: "f3" as UUID, name: "status" })];

      const baseTable = createDataTable("base", "Orders", baseFields);
      const joinTable1 = createDataTable("join1", "Shipments", join1Fields);
      const joinTable2 = createDataTable("join2", "Payments", join2Fields);
      const joins = [createJoin("join1"), createJoin("join2")];

      const result = computeCombinedFields(baseTable, joins, [
        baseTable,
        joinTable1,
        joinTable2,
      ]);

      expect(result.count).toBe(3);
      expect(result.fields[0].displayName).toBe("Orders.status");
      expect(result.fields[1].displayName).toBe("Shipments.status");
      expect(result.fields[2].displayName).toBe("Payments.status");
    });
  });

  // ============================================================================
  // computeCombinedFields() - Table Name Shortening
  // ============================================================================

  describe("computeCombinedFields() - table name shortening", () => {
    it("should shorten auto-generated table names for prefixes", () => {
      const baseFields = [createField({ id: "f1" as UUID, name: "id" })];
      const joinFields = [createField({ id: "f2" as UUID, name: "id" })];

      // Auto-generated names from CSV imports (with timestamps)
      const baseTable = createDataTable(
        "base",
        "sales_data_2024-01-01_123456.csv",
        baseFields,
      );
      const joinTable = createDataTable(
        "join1",
        "customer_info_2024-01-02_789012.csv",
        joinFields,
      );
      const joins = [createJoin("join1")];

      const result = computeCombinedFields(baseTable, joins, [baseTable, joinTable]);

      // Should use shortened names (from shortenAutoGeneratedName)
      expect(result.fields[0].displayName).toContain(".id");
      expect(result.fields[1].displayName).toContain(".id");
      // Shortened names should not include full timestamp suffix
      expect(result.fields[0].displayName).not.toContain("_2024-01-01_123456");
      expect(result.fields[1].displayName).not.toContain("_2024-01-02_789012");
    });

    it("should use simple table names when not auto-generated", () => {
      const baseFields = [createField({ id: "f1" as UUID, name: "id" })];
      const joinFields = [createField({ id: "f2" as UUID, name: "id" })];

      const baseTable = createDataTable("base", "Users", baseFields);
      const joinTable = createDataTable("join1", "Orders", joinFields);
      const joins = [createJoin("join1")];

      const result = computeCombinedFields(baseTable, joins, [baseTable, joinTable]);

      expect(result.fields[0].displayName).toBe("Users.id");
      expect(result.fields[1].displayName).toBe("Orders.id");
    });
  });

  // ============================================================================
  // computeCombinedFields() - Internal Field Filtering
  // ============================================================================

  describe("computeCombinedFields() - internal field filtering", () => {
    it("should exclude fields starting with underscore from base table", () => {
      const fields = [
        createField({ id: "f1" as UUID, name: "id" }),
        createField({ id: "f2" as UUID, name: "_internal" }),
        createField({ id: "f3" as UUID, name: "name" }),
      ];
      const baseTable = createDataTable("base", "Users", fields);

      const result = computeCombinedFields(baseTable, undefined, []);

      expect(result.count).toBe(2);
      expect(result.fields).toHaveLength(2);
      expect(result.fields[0].name).toBe("id");
      expect(result.fields[1].name).toBe("name");
      expect(result.fields.some((f) => f.name === "_internal")).toBe(false);
    });

    it("should exclude fields starting with underscore from joined tables", () => {
      const baseFields = [createField({ id: "f1" as UUID, name: "id" })];
      const joinFields = [
        createField({ id: "f2" as UUID, name: "order_id" }),
        createField({ id: "f3" as UUID, name: "_metadata" }),
        createField({ id: "f4" as UUID, name: "total" }),
      ];

      const baseTable = createDataTable("base", "Users", baseFields);
      const joinTable = createDataTable("join1", "Orders", joinFields);
      const joins = [createJoin("join1")];

      const result = computeCombinedFields(baseTable, joins, [baseTable, joinTable]);

      expect(result.count).toBe(3);
      expect(result.fields.some((f) => f.name === "_metadata")).toBe(false);
    });

    it("should exclude all internal fields from all tables", () => {
      const baseFields = [
        createField({ id: "f1" as UUID, name: "id" }),
        createField({ id: "f2" as UUID, name: "_rowid" }),
      ];
      const join1Fields = [
        createField({ id: "f3" as UUID, name: "_created" }),
        createField({ id: "f4" as UUID, name: "product" }),
      ];
      const join2Fields = [
        createField({ id: "f5" as UUID, name: "category" }),
        createField({ id: "f6" as UUID, name: "_updated" }),
      ];

      const baseTable = createDataTable("base", "Orders", baseFields);
      const joinTable1 = createDataTable("join1", "Products", join1Fields);
      const joinTable2 = createDataTable("join2", "Categories", join2Fields);
      const joins = [createJoin("join1"), createJoin("join2")];

      const result = computeCombinedFields(baseTable, joins, [
        baseTable,
        joinTable1,
        joinTable2,
      ]);

      expect(result.count).toBe(3);
      expect(result.fields.some((f) => f.name.startsWith("_"))).toBe(false);
    });
  });

  // ============================================================================
  // computeCombinedFields() - Edge Cases
  // ============================================================================

  describe("computeCombinedFields() - edge cases", () => {
    it("should handle base table with no fields", () => {
      const baseTable = createDataTable("base", "Empty", []);

      const result = computeCombinedFields(baseTable, undefined, []);

      expect(result.count).toBe(0);
      expect(result.fields).toHaveLength(0);
    });

    it("should handle base table with undefined fields", () => {
      const baseTable = createDataTable("base", "Empty", []);
      baseTable.fields = undefined;

      const result = computeCombinedFields(baseTable, undefined, []);

      expect(result.count).toBe(0);
      expect(result.fields).toHaveLength(0);
    });

    it("should handle joined table with no fields", () => {
      const baseFields = [createField({ id: "f1" as UUID, name: "id" })];
      const baseTable = createDataTable("base", "Users", baseFields);
      const joinTable = createDataTable("join1", "Empty", []);
      const joins = [createJoin("join1")];

      const result = computeCombinedFields(baseTable, joins, [baseTable, joinTable]);

      expect(result.count).toBe(1);
      expect(result.fields).toHaveLength(1);
      expect(result.fields[0].name).toBe("id");
    });

    it("should handle joined table not found in allDataTables", () => {
      const baseFields = [createField({ id: "f1" as UUID, name: "id" })];
      const baseTable = createDataTable("base", "Users", baseFields);
      const joins = [createJoin("nonexistent")];

      const result = computeCombinedFields(baseTable, joins, [baseTable]);

      // Should only return base table fields
      expect(result.count).toBe(1);
      expect(result.fields).toHaveLength(1);
      expect(result.fields[0].name).toBe("id");
    });

    it("should handle multiple joins with some tables not found", () => {
      const baseFields = [createField({ id: "f1" as UUID, name: "id" })];
      const join1Fields = [createField({ id: "f2" as UUID, name: "product" })];

      const baseTable = createDataTable("base", "Orders", baseFields);
      const joinTable1 = createDataTable("join1", "Products", join1Fields);
      const joins = [createJoin("join1"), createJoin("nonexistent")];

      const result = computeCombinedFields(baseTable, joins, [baseTable, joinTable1]);

      // Should include base + found join, skip missing join
      expect(result.count).toBe(2);
      expect(result.fields[0].name).toBe("id");
      expect(result.fields[1].name).toBe("product");
    });

    it("should handle fields without columnName property", () => {
      const baseFields = [
        createField({ id: "f1" as UUID, name: "user_id" }),
        // columnName is optional
      ];
      const joinFields = [
        createField({ id: "f2" as UUID, name: "user_id" }),
      ];

      const baseTable = createDataTable("base", "Users", baseFields);
      const joinTable = createDataTable("join1", "Profiles", joinFields);
      const joins = [createJoin("join1")];

      const result = computeCombinedFields(baseTable, joins, [baseTable, joinTable]);

      // Should use name when columnName is undefined
      expect(result.fields[0].displayName).toBe("Users.user_id");
      expect(result.fields[1].displayName).toBe("Profiles.user_id");
    });

    it("should handle empty joins array", () => {
      const fields = [createField({ id: "f1" as UUID, name: "id" })];
      const baseTable = createDataTable("base", "Users", fields);

      const result = computeCombinedFields(baseTable, [], [baseTable]);

      expect(result.count).toBe(1);
      expect(result.fields[0].displayName).toBe("id");
    });

    it("should handle all fields starting with underscore", () => {
      const fields = [
        createField({ id: "f1" as UUID, name: "_id" }),
        createField({ id: "f2" as UUID, name: "_created" }),
      ];
      const baseTable = createDataTable("base", "Internal", fields);

      const result = computeCombinedFields(baseTable, undefined, []);

      expect(result.count).toBe(0);
      expect(result.fields).toHaveLength(0);
    });
  });

  // ============================================================================
  // computeCombinedFields() - Integration Tests
  // ============================================================================

  describe("computeCombinedFields() - integration tests", () => {
    it("should handle realistic user-order join scenario", () => {
      const userFields = [
        createField({ id: "u1" as UUID, name: "id", columnName: "user_id" }),
        createField({ id: "u2" as UUID, name: "name", columnName: "user_name" }),
        createField({ id: "u3" as UUID, name: "email", columnName: "user_email" }),
      ];
      const orderFields = [
        createField({ id: "o1" as UUID, name: "id", columnName: "order_id" }),
        createField({ id: "o2" as UUID, name: "total", columnName: "order_total" }),
        createField({ id: "o3" as UUID, name: "date", columnName: "order_date" }),
      ];

      const usersTable = createDataTable("users", "Users", userFields);
      const ordersTable = createDataTable("orders", "Orders", orderFields);
      const joins = [createJoin("orders", "id", "user_id")];

      const result = computeCombinedFields(usersTable, joins, [usersTable, ordersTable]);

      expect(result.count).toBe(6);
      // Both tables have "id" field, so they should be prefixed
      expect(result.fields[0].displayName).toBe("Users.id");
      expect(result.fields[1].displayName).toBe("name");
      expect(result.fields[2].displayName).toBe("email");
      expect(result.fields[3].displayName).toBe("Orders.id");
      expect(result.fields[4].displayName).toBe("total");
      expect(result.fields[5].displayName).toBe("date");
    });

    it("should handle complex multi-table join with various collisions", () => {
      const leadFields = [
        createField({ id: "l1" as UUID, name: "id" }),
        createField({ id: "l2" as UUID, name: "name" }),
        createField({ id: "l3" as UUID, name: "status" }),
      ];
      const roomFields = [
        createField({ id: "r1" as UUID, name: "id" }),
        createField({ id: "r2" as UUID, name: "name" }),
        createField({ id: "r3" as UUID, name: "capacity" }),
      ];
      const bookingFields = [
        createField({ id: "b1" as UUID, name: "id" }),
        createField({ id: "b2" as UUID, name: "date" }),
        createField({ id: "b3" as UUID, name: "status" }),
      ];

      const leadsTable = createDataTable("leads", "Leads", leadFields);
      const roomsTable = createDataTable("rooms", "Rooms", roomFields);
      const bookingsTable = createDataTable("bookings", "Bookings", bookingFields);
      const joins = [createJoin("rooms"), createJoin("bookings")];

      const result = computeCombinedFields(leadsTable, joins, [
        leadsTable,
        roomsTable,
        bookingsTable,
      ]);

      expect(result.count).toBe(9);
      // "id" appears in all tables
      expect(result.fields[0].displayName).toBe("Leads.id");
      expect(result.fields[1].displayName).toBe("Leads.name");
      expect(result.fields[2].displayName).toBe("Leads.status");
      expect(result.fields[3].displayName).toBe("Rooms.id");
      expect(result.fields[4].displayName).toBe("Rooms.name");
      expect(result.fields[5].displayName).toBe("capacity");
      expect(result.fields[6].displayName).toBe("Bookings.id");
      expect(result.fields[7].displayName).toBe("date");
      expect(result.fields[8].displayName).toBe("Bookings.status");
    });

    it("should handle joined tables with internal fields", () => {
      const baseFields = [
        createField({ id: "f1" as UUID, name: "id" }),
        createField({ id: "f2" as UUID, name: "_internal_base" }),
      ];
      const joinFields = [
        createField({ id: "f3" as UUID, name: "product" }),
        createField({ id: "f4" as UUID, name: "_internal_join" }),
      ];

      const baseTable = createDataTable("base", "Orders", baseFields);
      const joinTable = createDataTable("join1", "Products", joinFields);
      const joins = [createJoin("join1")];

      const result = computeCombinedFields(baseTable, joins, [baseTable, joinTable]);

      expect(result.count).toBe(2);
      expect(result.fields[0].name).toBe("id");
      expect(result.fields[1].name).toBe("product");
      expect(result.fields.some((f) => f.name.startsWith("_"))).toBe(false);
    });

    it("should maintain correct source table IDs across multiple joins", () => {
      const baseFields = [createField({ id: "f1" as UUID, name: "base_field" })];
      const join1Fields = [createField({ id: "f2" as UUID, name: "join1_field" })];
      const join2Fields = [createField({ id: "f3" as UUID, name: "join2_field" })];

      const baseTable = createDataTable("base_id", "Base", baseFields);
      const joinTable1 = createDataTable("join1_id", "Join1", join1Fields);
      const joinTable2 = createDataTable("join2_id", "Join2", join2Fields);
      const joins = [createJoin("join1_id"), createJoin("join2_id")];

      const result = computeCombinedFields(baseTable, joins, [
        baseTable,
        joinTable1,
        joinTable2,
      ]);

      expect(result.fields[0].sourceTableId).toBe("base_id");
      expect(result.fields[1].sourceTableId).toBe("join1_id");
      expect(result.fields[2].sourceTableId).toBe("join2_id");
    });
  });

  // ============================================================================
  // computeCombinedFields() - Type Safety
  // ============================================================================

  describe("computeCombinedFields() - type safety", () => {
    it("should return object with fields array and count number", () => {
      const fields = [createField({ id: "f1" as UUID, name: "test" })];
      const baseTable = createDataTable("base", "Test", fields);

      const result = computeCombinedFields(baseTable, undefined, []);

      expect(result).toHaveProperty("fields");
      expect(result).toHaveProperty("count");
      expect(Array.isArray(result.fields)).toBe(true);
      expect(typeof result.count).toBe("number");
    });

    it("should ensure count matches fields length", () => {
      const fields = [
        createField({ id: "f1" as UUID, name: "field1" }),
        createField({ id: "f2" as UUID, name: "field2" }),
        createField({ id: "f3" as UUID, name: "field3" }),
      ];
      const baseTable = createDataTable("base", "Test", fields);

      const result = computeCombinedFields(baseTable, undefined, []);

      expect(result.count).toBe(result.fields.length);
      expect(result.count).toBe(3);
    });

    it("should preserve CombinedField type with extended properties", () => {
      const field = createField({ id: "f1" as UUID, name: "test", type: "string" });
      const baseTable = createDataTable("base", "Test", [field]);

      const result = computeCombinedFields(baseTable, undefined, []);

      const combinedField = result.fields[0];
      // Should have all Field properties
      expect(combinedField).toHaveProperty("id");
      expect(combinedField).toHaveProperty("name");
      expect(combinedField).toHaveProperty("type");
      // Plus CombinedField extensions
      expect(combinedField).toHaveProperty("sourceTableId");
      expect(combinedField).toHaveProperty("displayName");
    });

    it("should not mutate input baseTable", () => {
      const fields = [createField({ id: "f1" as UUID, name: "test" })];
      const baseTable = createDataTable("base", "Test", fields);
      const originalFieldsLength = baseTable.fields?.length;

      computeCombinedFields(baseTable, undefined, []);

      expect(baseTable.fields?.length).toBe(originalFieldsLength);
    });

    it("should not mutate input joins array", () => {
      const baseFields = [createField({ id: "f1" as UUID, name: "id" })];
      const joinFields = [createField({ id: "f2" as UUID, name: "product" })];
      const baseTable = createDataTable("base", "Orders", baseFields);
      const joinTable = createDataTable("join1", "Products", joinFields);
      const joins = [createJoin("join1")];
      const originalJoinsLength = joins.length;

      computeCombinedFields(baseTable, joins, [baseTable, joinTable]);

      expect(joins.length).toBe(originalJoinsLength);
    });

    it("should not mutate input allDataTables array", () => {
      const baseFields = [createField({ id: "f1" as UUID, name: "id" })];
      const baseTable = createDataTable("base", "Test", baseFields);
      const allTables = [baseTable];
      const originalTablesLength = allTables.length;

      computeCombinedFields(baseTable, undefined, allTables);

      expect(allTables.length).toBe(originalTablesLength);
    });
  });
});
