/**
 * Integration tests for Notion router with rate limiting
 *
 * Tests cover:
 * - Normal requests succeed
 * - Excessive requests return 429 (TOO_MANY_REQUESTS)
 * - Different endpoints have separate rate limits
 * - Error response includes retry information
 */
import {
  fetchNotionDatabases,
  fetchNotionDatabaseSchema,
  generateFieldsFromNotionSchema,
  notionToDataFrame,
} from "@dashframe/connector-notion";
import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { destroyAllRateLimiters } from "../middleware/rate-limit";
import type { Context } from "../server";
import { notionRouter } from "./notion";

// Mock the Notion connector functions
vi.mock("@dashframe/connector-notion", () => ({
  fetchNotionDatabases: vi.fn(),
  fetchNotionDatabaseSchema: vi.fn(),
  generateFieldsFromNotionSchema: vi.fn(),
  notionToDataFrame: vi.fn(),
}));

describe("notionRouter - rate limiting integration", () => {
  // Create a test context with mock headers
  const createTestContext = (ip = "203.0.113.1"): Context => ({
    headers: {
      "x-forwarded-for": ip,
    },
  });

  // Create a caller for testing
  const createCaller = (ctx: Context) => notionRouter.createCaller(ctx);

  beforeEach(() => {
    vi.useFakeTimers();
    // Reset all rate limiters before each test
    destroyAllRateLimiters();

    // Setup default mock responses
    vi.mocked(fetchNotionDatabases).mockResolvedValue({
      results: [],
      has_more: false,
      next_cursor: null,
    } as unknown as Awaited<ReturnType<typeof fetchNotionDatabases>>);

    vi.mocked(fetchNotionDatabaseSchema).mockResolvedValue({
      id: "test-db-id",
      title: [{ plain_text: "Test Database" }],
      properties: {},
    } as unknown as Awaited<ReturnType<typeof fetchNotionDatabaseSchema>>);

    vi.mocked(notionToDataFrame).mockResolvedValue({
      schema: {
        fields: [],
      },
      data: [],
    } as unknown as Awaited<ReturnType<typeof notionToDataFrame>>);

    vi.mocked(generateFieldsFromNotionSchema).mockReturnValue({
      fields: [],
      sourceSchema: { properties: {} },
    } as unknown as ReturnType<typeof generateFieldsFromNotionSchema>);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
    destroyAllRateLimiters();
  });

  describe("listDatabases endpoint", () => {
    it("should allow normal requests to succeed", async () => {
      const caller = createCaller(createTestContext());

      // Make 5 requests (under the 10 req/min limit)
      for (let i = 0; i < 5; i++) {
        const result = await caller.listDatabases({ apiKey: "test-key" });
        expect(result).toBeDefined();
        expect(fetchNotionDatabases).toHaveBeenCalledWith("test-key");
      }

      // All 5 requests should succeed
      expect(fetchNotionDatabases).toHaveBeenCalledTimes(5);
    });

    it("should block excessive requests with 429 error", async () => {
      const caller = createCaller(createTestContext());

      // Fill up the rate limit (10 requests)
      for (let i = 0; i < 10; i++) {
        await caller.listDatabases({ apiKey: "test-key" });
      }

      // 11th request should be blocked
      await expect(
        caller.listDatabases({ apiKey: "test-key" }),
      ).rejects.toThrow(TRPCError);

      try {
        await caller.listDatabases({ apiKey: "test-key" });
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        const trpcError = error as TRPCError;
        expect(trpcError.code).toBe("TOO_MANY_REQUESTS");
      }
    });

    it("should include retry information in error response", async () => {
      const caller = createCaller(createTestContext());

      // Fill up the rate limit
      for (let i = 0; i < 10; i++) {
        await caller.listDatabases({ apiKey: "test-key" });
      }

      // Next request should be blocked with retry info
      try {
        await caller.listDatabases({ apiKey: "test-key" });
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        const trpcError = error as TRPCError;

        expect(trpcError.code).toBe("TOO_MANY_REQUESTS");
        expect(trpcError.message).toContain("Rate limit exceeded");

        // Check error cause includes retry information
        expect(trpcError.cause).toBeDefined();
        const cause = trpcError.cause as unknown as {
          retryAfter: number;
          resetMs: number;
          clientIp: string;
        };

        expect(cause.retryAfter).toBeGreaterThan(0); // Seconds until reset
        expect(cause.resetMs).toBeGreaterThan(0); // Milliseconds until reset
        expect(cause.clientIp).toBe("203.0.113.1");
      }
    });

    it("should reset rate limit after window expires", async () => {
      const caller = createCaller(createTestContext());

      // Fill up the rate limit
      for (let i = 0; i < 10; i++) {
        await caller.listDatabases({ apiKey: "test-key" });
      }

      // Should be blocked
      await expect(
        caller.listDatabases({ apiKey: "test-key" }),
      ).rejects.toThrow(TRPCError);

      // Advance time past the 60-second window
      vi.advanceTimersByTime(60001);

      // Should work again
      const result = await caller.listDatabases({ apiKey: "test-key" });
      expect(result).toBeDefined();
      expect(fetchNotionDatabases).toHaveBeenCalledTimes(11); // 10 + 1 after reset
    });

    it("should track different IPs separately", async () => {
      const caller1 = createCaller(createTestContext("192.0.2.1"));
      const caller2 = createCaller(createTestContext("198.51.100.1"));

      // Fill up rate limit for IP 1
      for (let i = 0; i < 10; i++) {
        await caller1.listDatabases({ apiKey: "test-key" });
      }

      // IP 1 should be blocked
      await expect(
        caller1.listDatabases({ apiKey: "test-key" }),
      ).rejects.toThrow(TRPCError);

      // IP 2 should still work
      const result = await caller2.listDatabases({ apiKey: "test-key" });
      expect(result).toBeDefined();
      expect(fetchNotionDatabases).toHaveBeenCalledTimes(11);
    });
  });

  describe("getDatabaseSchema endpoint", () => {
    it("should allow normal requests to succeed", async () => {
      const caller = createCaller(createTestContext());

      // Make 10 requests (under the 20 req/min limit)
      for (let i = 0; i < 10; i++) {
        const result = await caller.getDatabaseSchema({
          apiKey: "test-key",
          databaseId: "test-db-id",
        });
        expect(result).toBeDefined();
      }

      expect(fetchNotionDatabaseSchema).toHaveBeenCalledTimes(10);
    });

    it("should block requests over 20 per minute", async () => {
      const caller = createCaller(createTestContext());

      // Fill up the rate limit (20 requests)
      for (let i = 0; i < 20; i++) {
        await caller.getDatabaseSchema({
          apiKey: "test-key",
          databaseId: "test-db-id",
        });
      }

      // 21st request should be blocked
      await expect(
        caller.getDatabaseSchema({
          apiKey: "test-key",
          databaseId: "test-db-id",
        }),
      ).rejects.toThrow(TRPCError);
    });
  });

  describe("queryDatabase endpoint", () => {
    it("should allow normal requests to succeed", async () => {
      const caller = createCaller(createTestContext());

      // Make 15 requests (under the 30 req/min limit)
      for (let i = 0; i < 15; i++) {
        const result = await caller.queryDatabase({
          apiKey: "test-key",
          databaseId: "test-db-id",
        });
        expect(result).toBeDefined();
      }

      expect(fetchNotionDatabaseSchema).toHaveBeenCalledTimes(15);
      expect(notionToDataFrame).toHaveBeenCalledTimes(15);
    });

    it("should block requests over 30 per minute", async () => {
      const caller = createCaller(createTestContext());

      // Fill up the rate limit (30 requests)
      for (let i = 0; i < 30; i++) {
        await caller.queryDatabase({
          apiKey: "test-key",
          databaseId: "test-db-id",
        });
      }

      // 31st request should be blocked
      await expect(
        caller.queryDatabase({
          apiKey: "test-key",
          databaseId: "test-db-id",
        }),
      ).rejects.toThrow(TRPCError);
    });
  });

  describe("separate rate limits per endpoint", () => {
    it("should maintain independent rate limits for different endpoints", async () => {
      const caller = createCaller(createTestContext());

      // Fill up listDatabases (10 req/min)
      for (let i = 0; i < 10; i++) {
        await caller.listDatabases({ apiKey: "test-key" });
      }

      // listDatabases should be blocked
      await expect(
        caller.listDatabases({ apiKey: "test-key" }),
      ).rejects.toThrow(TRPCError);

      // getDatabaseSchema should still work (separate limit)
      const schemaResult = await caller.getDatabaseSchema({
        apiKey: "test-key",
        databaseId: "test-db-id",
      });
      expect(schemaResult).toBeDefined();

      // queryDatabase should still work (separate limit)
      const queryResult = await caller.queryDatabase({
        apiKey: "test-key",
        databaseId: "test-db-id",
      });
      expect(queryResult).toBeDefined();

      // Verify the expected number of calls
      expect(fetchNotionDatabases).toHaveBeenCalledTimes(10);
      expect(fetchNotionDatabaseSchema).toHaveBeenCalledTimes(2); // 1 for schema + 1 in query
      expect(notionToDataFrame).toHaveBeenCalledTimes(1);
    });

    it("should allow different limits to be exhausted independently", async () => {
      const caller = createCaller(createTestContext());

      // Exhaust all three endpoints
      // 1. listDatabases (10 requests)
      for (let i = 0; i < 10; i++) {
        await caller.listDatabases({ apiKey: "test-key" });
      }

      // 2. getDatabaseSchema (20 requests)
      for (let i = 0; i < 20; i++) {
        await caller.getDatabaseSchema({
          apiKey: "test-key",
          databaseId: "test-db-id",
        });
      }

      // 3. queryDatabase (30 requests)
      for (let i = 0; i < 30; i++) {
        await caller.queryDatabase({
          apiKey: "test-key",
          databaseId: "test-db-id",
        });
      }

      // All three should now be blocked
      await expect(
        caller.listDatabases({ apiKey: "test-key" }),
      ).rejects.toThrow(TRPCError);

      await expect(
        caller.getDatabaseSchema({
          apiKey: "test-key",
          databaseId: "test-db-id",
        }),
      ).rejects.toThrow(TRPCError);

      await expect(
        caller.queryDatabase({
          apiKey: "test-key",
          databaseId: "test-db-id",
        }),
      ).rejects.toThrow(TRPCError);

      // Verify call counts
      expect(fetchNotionDatabases).toHaveBeenCalledTimes(10);
      expect(fetchNotionDatabaseSchema).toHaveBeenCalledTimes(50); // 20 for schema + 30 in query
      expect(notionToDataFrame).toHaveBeenCalledTimes(30);
    });
  });

  describe("error message clarity", () => {
    it("should include endpoint name in error message for listDatabases", async () => {
      const caller = createCaller(createTestContext());

      // Fill up the limit
      for (let i = 0; i < 10; i++) {
        await caller.listDatabases({ apiKey: "test-key" });
      }

      try {
        await caller.listDatabases({ apiKey: "test-key" });
        expect(true).toBe(false);
      } catch (error) {
        const trpcError = error as TRPCError;
        expect(trpcError.message).toContain("endpoint");
        expect(trpcError.message).toContain("Rate limit exceeded");
        expect(trpcError.message).toContain("try again later");
      }
    });

    it("should include endpoint name in error message for getDatabaseSchema", async () => {
      const caller = createCaller(createTestContext());

      // Fill up the limit
      for (let i = 0; i < 20; i++) {
        await caller.getDatabaseSchema({
          apiKey: "test-key",
          databaseId: "test-db-id",
        });
      }

      try {
        await caller.getDatabaseSchema({
          apiKey: "test-key",
          databaseId: "test-db-id",
        });
        expect(true).toBe(false);
      } catch (error) {
        const trpcError = error as TRPCError;
        expect(trpcError.message).toContain("getDatabaseSchema");
        expect(trpcError.message).toContain("Rate limit exceeded");
      }
    });

    it("should include endpoint name in error message for queryDatabase", async () => {
      const caller = createCaller(createTestContext());

      // Fill up the limit
      for (let i = 0; i < 30; i++) {
        await caller.queryDatabase({
          apiKey: "test-key",
          databaseId: "test-db-id",
        });
      }

      try {
        await caller.queryDatabase({
          apiKey: "test-key",
          databaseId: "test-db-id",
        });
        expect(true).toBe(false);
      } catch (error) {
        const trpcError = error as TRPCError;
        expect(trpcError.message).toContain("queryDatabase");
        expect(trpcError.message).toContain("Rate limit exceeded");
      }
    });
  });
});
