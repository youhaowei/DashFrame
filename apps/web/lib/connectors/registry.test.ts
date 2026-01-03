/**
 * Unit tests for connectors/registry module
 *
 * Tests cover:
 * - getConnectors() - Connector retrieval with filtering
 *   - Default behavior (Notion hidden)
 *   - Feature flag filtering (showNotion)
 *   - Source type filtering (file vs remote-api)
 *   - Combined filtering
 * - getConnectorById() - Specific connector lookup
 *   - Existing connector IDs (csv, notion)
 *   - Non-existent IDs
 * - getFileConnectors() - File connector type guard filtering
 *   - CSV connector only
 *   - Feature flag interaction
 * - getRemoteConnectors() - Remote API connector type guard filtering
 *   - Notion connector only
 *   - Feature flag interaction
 * - getConnectorIds() - All connector ID extraction
 */
import { describe, expect, it } from "vitest";
import {
  getConnectors,
  getConnectorById,
  getFileConnectors,
  getRemoteConnectors,
  getConnectorIds,
} from "./registry";

describe("connectors/registry", () => {
  // ============================================================================
  // getConnectors() - Connector Retrieval with Filtering
  // ============================================================================

  describe("getConnectors()", () => {
    describe("Default Behavior", () => {
      it("should return only CSV connector by default (Notion hidden)", () => {
        const connectors = getConnectors();

        expect(connectors).toHaveLength(1);
        expect(connectors[0].id).toBe("csv");
      });

      it("should return CSV connector with file sourceType", () => {
        const connectors = getConnectors();

        expect(connectors[0].sourceType).toBe("file");
      });

      it("should preserve connector order from registration", () => {
        const connectors = getConnectors({ showNotion: true });

        // CSV registered first, Notion second
        expect(connectors[0].id).toBe("csv");
        expect(connectors[1].id).toBe("notion");
      });
    });

    describe("Feature Flag Filtering (showNotion)", () => {
      it("should include Notion when showNotion is true", () => {
        const connectors = getConnectors({ showNotion: true });

        expect(connectors).toHaveLength(2);
        expect(connectors.map((c) => c.id)).toEqual(["csv", "notion"]);
      });

      it("should exclude Notion when showNotion is false", () => {
        const connectors = getConnectors({ showNotion: false });

        expect(connectors).toHaveLength(1);
        expect(connectors[0].id).toBe("csv");
      });

      it("should exclude Notion when showNotion is undefined (default)", () => {
        const connectors = getConnectors({ showNotion: undefined });

        expect(connectors).toHaveLength(1);
        expect(connectors[0].id).toBe("csv");
      });
    });

    describe("Source Type Filtering", () => {
      it("should return only file connectors when sourceType is 'file'", () => {
        const connectors = getConnectors({
          sourceType: "file",
          showNotion: true, // Enable all connectors first
        });

        expect(connectors).toHaveLength(1);
        expect(connectors[0].id).toBe("csv");
        expect(connectors[0].sourceType).toBe("file");
      });

      it("should return only remote-api connectors when sourceType is 'remote-api'", () => {
        const connectors = getConnectors({
          sourceType: "remote-api",
          showNotion: true, // Enable all connectors first
        });

        expect(connectors).toHaveLength(1);
        expect(connectors[0].id).toBe("notion");
        expect(connectors[0].sourceType).toBe("remote-api");
      });

      it("should return empty array when filtering file with Notion hidden", () => {
        const connectors = getConnectors({
          sourceType: "remote-api",
          showNotion: false,
        });

        expect(connectors).toHaveLength(0);
      });

      it("should return all connectors when no sourceType specified", () => {
        const connectors = getConnectors({ showNotion: true });

        expect(connectors).toHaveLength(2);
      });
    });

    describe("Combined Filtering", () => {
      it("should apply both feature flag and sourceType filters", () => {
        const connectors = getConnectors({
          showNotion: true,
          sourceType: "file",
        });

        expect(connectors).toHaveLength(1);
        expect(connectors[0].id).toBe("csv");
      });

      it("should handle empty options object", () => {
        const connectors = getConnectors({});

        // Empty options = no Notion (default false), no sourceType filter
        expect(connectors).toHaveLength(1);
        expect(connectors[0].id).toBe("csv");
      });
    });

    describe("Connector Properties", () => {
      it("should return connectors with all required properties", () => {
        const connectors = getConnectors({ showNotion: true });

        connectors.forEach((connector) => {
          expect(connector).toHaveProperty("id");
          expect(connector).toHaveProperty("name");
          expect(connector).toHaveProperty("description");
          expect(connector).toHaveProperty("icon");
          expect(connector).toHaveProperty("sourceType");
          expect(typeof connector.id).toBe("string");
          expect(typeof connector.name).toBe("string");
          expect(typeof connector.description).toBe("string");
        });
      });

      it("should return CSV connector with correct metadata", () => {
        const connectors = getConnectors();

        expect(connectors[0].id).toBe("csv");
        expect(connectors[0].name).toBe("CSV File");
        expect(connectors[0].sourceType).toBe("file");
      });

      it("should return Notion connector with correct metadata", () => {
        const connectors = getConnectors({ showNotion: true });
        const notionConnector = connectors.find((c) => c.id === "notion");

        expect(notionConnector).toBeDefined();
        expect(notionConnector?.name).toBe("Notion Database");
        expect(notionConnector?.sourceType).toBe("remote-api");
      });
    });
  });

  // ============================================================================
  // getConnectorById() - Specific Connector Lookup
  // ============================================================================

  describe("getConnectorById()", () => {
    describe("Existing Connector IDs", () => {
      it("should return CSV connector by ID", () => {
        const connector = getConnectorById("csv");

        expect(connector).toBeDefined();
        expect(connector?.id).toBe("csv");
        expect(connector?.name).toBe("CSV File");
        expect(connector?.sourceType).toBe("file");
      });

      it("should return Notion connector by ID (regardless of feature flag)", () => {
        const connector = getConnectorById("notion");

        expect(connector).toBeDefined();
        expect(connector?.id).toBe("notion");
        expect(connector?.name).toBe("Notion Database");
        expect(connector?.sourceType).toBe("remote-api");
      });
    });

    describe("Non-existent IDs", () => {
      it("should return undefined for non-existent ID", () => {
        const connector = getConnectorById("postgres");

        expect(connector).toBeUndefined();
      });

      it("should return undefined for empty string", () => {
        const connector = getConnectorById("");

        expect(connector).toBeUndefined();
      });

      it("should return undefined for case-mismatch", () => {
        const connector = getConnectorById("CSV"); // uppercase

        expect(connector).toBeUndefined();
      });

      it("should return undefined for partial match", () => {
        const connector = getConnectorById("cs");

        expect(connector).toBeUndefined();
      });
    });

    describe("Edge Cases", () => {
      it("should handle special characters in ID", () => {
        const connector = getConnectorById("csv-special-@#$");

        expect(connector).toBeUndefined();
      });

      it("should handle numeric string IDs", () => {
        const connector = getConnectorById("123");

        expect(connector).toBeUndefined();
      });
    });
  });

  // ============================================================================
  // getFileConnectors() - File Connector Type Guard Filtering
  // ============================================================================

  describe("getFileConnectors()", () => {
    describe("Basic Functionality", () => {
      it("should return only CSV connector (file type)", () => {
        const connectors = getFileConnectors();

        expect(connectors).toHaveLength(1);
        expect(connectors[0].id).toBe("csv");
        expect(connectors[0].sourceType).toBe("file");
      });

      it("should return connectors with FileSourceConnector type", () => {
        const connectors = getFileConnectors();

        // Type guard should narrow to FileSourceConnector
        connectors.forEach((connector) => {
          expect(connector.sourceType).toBe("file");
          // File connectors have accept and maxSizeMB properties
          expect(connector).toHaveProperty("accept");
          expect(connector).toHaveProperty("maxSizeMB");
        });
      });
    });

    describe("Feature Flag Interaction", () => {
      it("should not include Notion even with showNotion=true", () => {
        const connectors = getFileConnectors({ showNotion: true });

        // Notion is remote-api, not file
        expect(connectors).toHaveLength(1);
        expect(connectors[0].id).toBe("csv");
      });

      it("should apply showNotion flag before type filtering", () => {
        const withNotion = getFileConnectors({ showNotion: true });
        const withoutNotion = getFileConnectors({ showNotion: false });

        // Both should return same result (CSV only)
        expect(withNotion).toHaveLength(1);
        expect(withoutNotion).toHaveLength(1);
        expect(withNotion[0].id).toBe(withoutNotion[0].id);
      });
    });

    describe("Type Safety", () => {
      it("should return array of FileSourceConnector type", () => {
        const connectors = getFileConnectors();

        // All should have file-specific properties
        connectors.forEach((connector) => {
          expect(connector.accept).toBeDefined();
          expect(connector.maxSizeMB).toBeDefined();
          expect(typeof connector.accept).toBe("string");
          expect(typeof connector.maxSizeMB).toBe("number");
        });
      });

      it("should exclude connectors without file-specific properties", () => {
        const connectors = getFileConnectors({ showNotion: true });

        // Should not include Notion (which lacks file properties)
        expect(connectors.every((c) => c.id !== "notion")).toBe(true);
      });
    });
  });

  // ============================================================================
  // getRemoteConnectors() - Remote API Connector Type Guard Filtering
  // ============================================================================

  describe("getRemoteConnectors()", () => {
    describe("Basic Functionality", () => {
      it("should return empty array by default (Notion hidden)", () => {
        const connectors = getRemoteConnectors();

        expect(connectors).toHaveLength(0);
      });

      it("should return only Notion connector with showNotion=true", () => {
        const connectors = getRemoteConnectors({ showNotion: true });

        expect(connectors).toHaveLength(1);
        expect(connectors[0].id).toBe("notion");
        expect(connectors[0].sourceType).toBe("remote-api");
      });

      it("should return connectors with RemoteApiConnector type", () => {
        const connectors = getRemoteConnectors({ showNotion: true });

        // Type guard should narrow to RemoteApiConnector
        connectors.forEach((connector) => {
          expect(connector.sourceType).toBe("remote-api");
          // Remote connectors have remoteApi property
          expect(connector).toHaveProperty("remoteApi");
        });
      });
    });

    describe("Feature Flag Interaction", () => {
      it("should respect showNotion flag", () => {
        const withNotion = getRemoteConnectors({ showNotion: true });
        const withoutNotion = getRemoteConnectors({ showNotion: false });

        expect(withNotion).toHaveLength(1);
        expect(withNotion[0].id).toBe("notion");
        expect(withoutNotion).toHaveLength(0);
      });

      it("should not include CSV even without filtering", () => {
        const connectors = getRemoteConnectors({ showNotion: true });

        // CSV is file, not remote-api
        expect(connectors.every((c) => c.id !== "csv")).toBe(true);
      });
    });

    describe("Type Safety", () => {
      it("should return array of RemoteApiConnector type", () => {
        const connectors = getRemoteConnectors({ showNotion: true });

        // All should have remote-api-specific properties
        connectors.forEach((connector) => {
          expect(connector.remoteApi).toBeDefined();
          expect(typeof connector.remoteApi).toBe("string");
        });
      });

      it("should exclude connectors without remote-api properties", () => {
        const connectors = getRemoteConnectors({ showNotion: true });

        // Should not include CSV (which lacks remoteApi property)
        expect(connectors.every((c) => c.id !== "csv")).toBe(true);
      });
    });
  });

  // ============================================================================
  // getConnectorIds() - All Connector ID Extraction
  // ============================================================================

  describe("getConnectorIds()", () => {
    describe("Basic Functionality", () => {
      it("should return array of all connector IDs", () => {
        const ids = getConnectorIds();

        expect(ids).toHaveLength(2);
        expect(ids).toEqual(["csv", "notion"]);
      });

      it("should include all connectors regardless of feature flags", () => {
        const ids = getConnectorIds();

        // Should include Notion even though it's hidden by default
        expect(ids).toContain("csv");
        expect(ids).toContain("notion");
      });

      it("should preserve registration order", () => {
        const ids = getConnectorIds();

        expect(ids[0]).toBe("csv");
        expect(ids[1]).toBe("notion");
      });
    });

    describe("Return Type", () => {
      it("should return array of strings", () => {
        const ids = getConnectorIds();

        expect(Array.isArray(ids)).toBe(true);
        ids.forEach((id) => {
          expect(typeof id).toBe("string");
        });
      });

      it("should return unique IDs", () => {
        const ids = getConnectorIds();
        const uniqueIds = new Set(ids);

        expect(ids.length).toBe(uniqueIds.size);
      });

      it("should return non-empty strings", () => {
        const ids = getConnectorIds();

        ids.forEach((id) => {
          expect(id.length).toBeGreaterThan(0);
        });
      });
    });

    describe("Consistency", () => {
      it("should match IDs from getConnectors()", () => {
        const allIds = getConnectorIds();
        const connectorIds = getConnectors({ showNotion: true }).map(
          (c) => c.id,
        );

        expect(allIds).toEqual(connectorIds);
      });

      it("should return same result on multiple calls", () => {
        const ids1 = getConnectorIds();
        const ids2 = getConnectorIds();

        expect(ids1).toEqual(ids2);
      });

      it("should be immutable (different array instance)", () => {
        const ids1 = getConnectorIds();
        const ids2 = getConnectorIds();

        expect(ids1).not.toBe(ids2); // Different instances
        expect(ids1).toEqual(ids2); // Same values
      });
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe("Integration Tests", () => {
    describe("Complete Workflow", () => {
      it("should support connector discovery and retrieval workflow", () => {
        // 1. Get all connector IDs
        const allIds = getConnectorIds();
        expect(allIds).toHaveLength(2);

        // 2. Get each connector by ID
        const csvConnector = getConnectorById(allIds[0]);
        const notionConnector = getConnectorById(allIds[1]);

        expect(csvConnector?.id).toBe("csv");
        expect(notionConnector?.id).toBe("notion");

        // 3. Filter by type
        const fileConnectors = getFileConnectors({ showNotion: true });
        const remoteConnectors = getRemoteConnectors({ showNotion: true });

        expect(fileConnectors).toHaveLength(1);
        expect(remoteConnectors).toHaveLength(1);
        expect(fileConnectors[0].id).toBe(csvConnector?.id);
        expect(remoteConnectors[0].id).toBe(notionConnector?.id);
      });

      it("should support feature flag toggling workflow", () => {
        // Notion hidden by default
        const defaultConnectors = getConnectors();
        expect(defaultConnectors.some((c) => c.id === "notion")).toBe(false);

        // Enable Notion
        const withNotion = getConnectors({ showNotion: true });
        expect(withNotion.some((c) => c.id === "notion")).toBe(true);

        // Disable Notion
        const withoutNotion = getConnectors({ showNotion: false });
        expect(withoutNotion.some((c) => c.id === "notion")).toBe(false);
      });

      it("should support combined filtering workflow", () => {
        // Get all remote connectors with Notion enabled
        const remoteConnectors = getRemoteConnectors({ showNotion: true });
        expect(remoteConnectors).toHaveLength(1);

        // Get all file connectors (Notion flag irrelevant)
        const fileConnectors = getFileConnectors();
        expect(fileConnectors).toHaveLength(1);

        // Verify no overlap
        const remoteIds = remoteConnectors.map((c) => c.id);
        const fileIds = fileConnectors.map((c) => c.id);
        const overlap = remoteIds.filter((id) => fileIds.includes(id));
        expect(overlap).toHaveLength(0);
      });
    });

    describe("Type Guard Filtering", () => {
      it("should properly narrow types with isFileConnector", () => {
        const allConnectors = getConnectors({ showNotion: true });
        const fileConnectors = getFileConnectors({ showNotion: true });

        // All file connectors should be in allConnectors
        expect(allConnectors.length).toBeGreaterThanOrEqual(
          fileConnectors.length,
        );

        // File connectors should have file-specific properties
        fileConnectors.forEach((connector) => {
          expect(connector.sourceType).toBe("file");
          expect(connector.accept).toBeDefined();
          expect(connector.maxSizeMB).toBeDefined();
        });
      });

      it("should properly narrow types with isRemoteApiConnector", () => {
        const allConnectors = getConnectors({ showNotion: true });
        const remoteConnectors = getRemoteConnectors({ showNotion: true });

        // All remote connectors should be in allConnectors
        expect(allConnectors.length).toBeGreaterThanOrEqual(
          remoteConnectors.length,
        );

        // Remote connectors should have remote-api-specific properties
        remoteConnectors.forEach((connector) => {
          expect(connector.sourceType).toBe("remote-api");
          expect(connector.remoteApi).toBeDefined();
        });
      });

      it("should partition connectors into file and remote types", () => {
        const fileConnectors = getFileConnectors({ showNotion: true });
        const remoteConnectors = getRemoteConnectors({ showNotion: true });
        const allConnectors = getConnectors({ showNotion: true });

        // File + remote should equal all connectors
        expect(fileConnectors.length + remoteConnectors.length).toBe(
          allConnectors.length,
        );
      });
    });
  });

  // ============================================================================
  // Type Safety Guarantees
  // ============================================================================

  describe("Type Safety Guarantees", () => {
    it("should maintain connector immutability", () => {
      const connectors1 = getConnectors({ showNotion: true });
      const connectors2 = getConnectors({ showNotion: true });

      // Different array instances
      expect(connectors1).not.toBe(connectors2);

      // Same connector instances (singletons)
      expect(connectors1[0]).toBe(connectors2[0]);
      expect(connectors1[1]).toBe(connectors2[1]);
    });

    it("should return consistent connector instances", () => {
      const csvFromGetConnectors = getConnectors()[0];
      const csvFromGetById = getConnectorById("csv");
      const csvFromGetFileConnectors = getFileConnectors()[0];

      // All should reference the same singleton instance
      expect(csvFromGetConnectors).toBe(csvFromGetById);
      expect(csvFromGetConnectors).toBe(csvFromGetFileConnectors);
    });

    it("should enforce sourceType consistency", () => {
      const allConnectors = getConnectors({ showNotion: true });

      allConnectors.forEach((connector) => {
        if (connector.id === "csv") {
          expect(connector.sourceType).toBe("file");
        } else if (connector.id === "notion") {
          expect(connector.sourceType).toBe("remote-api");
        }
      });
    });

    it("should ensure all functions return non-null values", () => {
      const connectors = getConnectors({ showNotion: true });
      const fileConnectors = getFileConnectors({ showNotion: true });
      const remoteConnectors = getRemoteConnectors({ showNotion: true });
      const ids = getConnectorIds();

      // All should return non-null arrays
      expect(connectors).toBeDefined();
      expect(fileConnectors).toBeDefined();
      expect(remoteConnectors).toBeDefined();
      expect(ids).toBeDefined();

      // All should be arrays
      expect(Array.isArray(connectors)).toBe(true);
      expect(Array.isArray(fileConnectors)).toBe(true);
      expect(Array.isArray(remoteConnectors)).toBe(true);
      expect(Array.isArray(ids)).toBe(true);
    });
  });
});
