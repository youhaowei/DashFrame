/**
 * Unit tests for rate-limiter module
 *
 * Tests cover:
 * - Basic rate limiting (under/over limit)
 * - Sliding window algorithm (expiration, time-based resets)
 * - Concurrent requests handling
 * - Memory cleanup and leak prevention
 * - Helper functions (getClientIp)
 * - Instance management (reset, clear, destroy)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRateLimiter,
  getClientIp,
  type RateLimiter,
} from "./rate-limiter";

describe("rate-limiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    limiter?.destroy();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe("createRateLimiter()", () => {
    it("should create limiter with default options", () => {
      limiter = createRateLimiter();

      const result = limiter.checkLimit("test-id");
      expect(result).toEqual({
        success: true,
        remaining: 9, // 10 - 1
        reset: expect.any(Number),
      });
    });

    it("should create limiter with custom options", () => {
      limiter = createRateLimiter({
        windowMs: 5000,
        maxRequests: 3,
      });

      // First request
      limiter.checkLimit("test-id");
      // Second request
      limiter.checkLimit("test-id");
      // Third request
      const result = limiter.checkLimit("test-id");

      expect(result.success).toBe(true);
      expect(result.remaining).toBe(0);

      // Fourth request should be blocked
      const blocked = limiter.checkLimit("test-id");
      expect(blocked.success).toBe(false);
    });
  });

  describe("checkLimit() - basic functionality", () => {
    beforeEach(() => {
      limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 5,
      });
    });

    it("should allow first request for new identifier", () => {
      const result = limiter.checkLimit("user-1");

      expect(result.success).toBe(true);
      expect(result.remaining).toBe(4); // 5 - 1
      expect(result.reset).toBeGreaterThan(0);
    });

    it("should allow requests under the limit", () => {
      limiter.checkLimit("user-1"); // 1
      limiter.checkLimit("user-1"); // 2
      limiter.checkLimit("user-1"); // 3
      const result = limiter.checkLimit("user-1"); // 4

      expect(result.success).toBe(true);
      expect(result.remaining).toBe(1); // 5 - 4
    });

    it("should allow request at exact limit", () => {
      limiter.checkLimit("user-1"); // 1
      limiter.checkLimit("user-1"); // 2
      limiter.checkLimit("user-1"); // 3
      limiter.checkLimit("user-1"); // 4
      const result = limiter.checkLimit("user-1"); // 5 (at limit)

      expect(result.success).toBe(true);
      expect(result.remaining).toBe(0);
    });

    it("should block requests over the limit", () => {
      // Fill up the limit
      for (let i = 0; i < 5; i++) {
        limiter.checkLimit("user-1");
      }

      // This should be blocked
      const result = limiter.checkLimit("user-1");

      expect(result.success).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.reset).toBeGreaterThan(0);
    });

    it("should return correct remaining count", () => {
      const r1 = limiter.checkLimit("user-1");
      expect(r1.remaining).toBe(4);

      const r2 = limiter.checkLimit("user-1");
      expect(r2.remaining).toBe(3);

      const r3 = limiter.checkLimit("user-1");
      expect(r3.remaining).toBe(2);
    });
  });

  describe("checkLimit() - sliding window", () => {
    beforeEach(() => {
      limiter = createRateLimiter({
        windowMs: 10000, // 10 second window
        maxRequests: 3,
      });
    });

    it("should reset after window expires", () => {
      // Fill up the limit
      limiter.checkLimit("user-1"); // t=0
      limiter.checkLimit("user-1"); // t=0
      limiter.checkLimit("user-1"); // t=0

      // Should be blocked
      const blocked = limiter.checkLimit("user-1");
      expect(blocked.success).toBe(false);

      // Advance time beyond the window (10 seconds + 1ms)
      vi.advanceTimersByTime(10001);

      // Should be allowed now (old requests expired)
      const allowed = limiter.checkLimit("user-1");
      expect(allowed.success).toBe(true);
      expect(allowed.remaining).toBe(2);
    });

    it("should partially reset as timestamps expire", () => {
      limiter.checkLimit("user-1"); // t=0
      vi.advanceTimersByTime(3000); // t=3000

      limiter.checkLimit("user-1"); // t=3000
      limiter.checkLimit("user-1"); // t=3000

      // Should be blocked
      const blocked = limiter.checkLimit("user-1");
      expect(blocked.success).toBe(false);

      // Advance time so the first request expires (from t=0 to t=10001)
      // Now at t=13001, window is [3001, 13001]
      vi.advanceTimersByTime(10001);

      // First request at t=0 should be expired
      // Only 2 requests remain (from t=3000)
      const allowed = limiter.checkLimit("user-1");
      expect(allowed.success).toBe(true);
      expect(allowed.remaining).toBe(0); // 3 total, now have 3
    });

    it("should calculate correct reset time", () => {
      const r1 = limiter.checkLimit("user-1"); // t=0
      // Reset time should be ~10000ms (when this first request expires)
      expect(r1.reset).toBeGreaterThanOrEqual(9900);
      expect(r1.reset).toBeLessThanOrEqual(10000);

      vi.advanceTimersByTime(3000); // t=3000

      const r2 = limiter.checkLimit("user-1"); // t=3000
      // Reset time should be ~7000ms (when first request expires: 10000 - 3000)
      expect(r2.reset).toBeGreaterThanOrEqual(6900);
      expect(r2.reset).toBeLessThanOrEqual(7000);
    });

    it("should return reset time of 0 when at limit and oldest is expired", () => {
      limiter.checkLimit("user-1"); // t=0
      limiter.checkLimit("user-1"); // t=0
      limiter.checkLimit("user-1"); // t=0

      // Advance time past the window
      vi.advanceTimersByTime(10001);

      // Next check should have reset time of 0 or very small
      const result = limiter.checkLimit("user-1");
      expect(result.success).toBe(true);
      expect(result.reset).toBeGreaterThanOrEqual(0);
    });
  });

  describe("checkLimit() - multiple identifiers", () => {
    beforeEach(() => {
      limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 2,
      });
    });

    it("should track different identifiers separately", () => {
      limiter.checkLimit("user-1");
      limiter.checkLimit("user-1");

      limiter.checkLimit("user-2");

      // user-1 should be blocked (2 requests made)
      const r1 = limiter.checkLimit("user-1");
      expect(r1.success).toBe(false);

      // user-2 should still have 1 remaining
      const r2 = limiter.checkLimit("user-2");
      expect(r2.success).toBe(true);
      expect(r2.remaining).toBe(0);
    });

    it("should not interfere between identifiers", () => {
      // Fill up user-1
      limiter.checkLimit("user-1");
      limiter.checkLimit("user-1");

      // user-2 should start fresh
      const r1 = limiter.checkLimit("user-2");
      expect(r1.success).toBe(true);
      expect(r1.remaining).toBe(1);

      // user-3 should also start fresh
      const r2 = limiter.checkLimit("user-3");
      expect(r2.success).toBe(true);
      expect(r2.remaining).toBe(1);
    });
  });

  describe("checkLimit() - concurrent requests", () => {
    beforeEach(() => {
      limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
      });
    });

    it("should handle rapid sequential requests correctly", () => {
      const results = [];
      for (let i = 0; i < 12; i++) {
        results.push(limiter.checkLimit("user-1"));
      }

      // First 10 should succeed
      for (let i = 0; i < 10; i++) {
        expect(results[i].success).toBe(true);
      }

      // Last 2 should fail
      expect(results[10].success).toBe(false);
      expect(results[11].success).toBe(false);
    });

    it("should handle concurrent requests from different users", () => {
      const user1Results = [];
      const user2Results = [];

      // Simulate concurrent requests
      for (let i = 0; i < 5; i++) {
        user1Results.push(limiter.checkLimit("user-1"));
        user2Results.push(limiter.checkLimit("user-2"));
      }

      // Both users should have 5 successful requests
      user1Results.forEach((r) => expect(r.success).toBe(true));
      user2Results.forEach((r) => expect(r.success).toBe(true));

      // Both should have 5 remaining
      expect(user1Results[4].remaining).toBe(5);
      expect(user2Results[4].remaining).toBe(5);
    });
  });

  describe("Memory cleanup", () => {
    it("should remove stale entries after 2x window duration", () => {
      limiter = createRateLimiter({
        windowMs: 10000, // 10 second window
        maxRequests: 5,
        cleanupIntervalMs: 5000, // Run cleanup every 5 seconds
      });

      // Make some requests
      limiter.checkLimit("user-1");
      limiter.checkLimit("user-2");

      // Advance time past cleanup interval but not past expiration
      vi.advanceTimersByTime(5000);

      // Entries should still exist (lastAccess < 2x window)
      const r1 = limiter.checkLimit("user-1");
      expect(r1.remaining).toBe(3); // Should have previous history

      // Advance time past 2x window duration (20 seconds total)
      vi.advanceTimersByTime(16000); // 5000 + 16000 = 21000ms

      // Trigger cleanup by advancing past another cleanup interval
      vi.advanceTimersByTime(5000); // Total: 26000ms

      // Make a new request - should start fresh (old entry was cleaned)
      const r2 = limiter.checkLimit("user-2");
      expect(r2.remaining).toBe(4); // Fresh start
    });

    it("should run cleanup automatically on interval", () => {
      limiter = createRateLimiter({
        windowMs: 10000,
        maxRequests: 5,
        cleanupIntervalMs: 1000, // 1 second cleanup interval
      });

      // Access internal cleanup by checking if entries are removed
      limiter.checkLimit("user-1");

      // Advance time past 2x window + cleanup interval
      vi.advanceTimersByTime(21000);

      // Check if the entry was cleaned up
      const result = limiter.checkLimit("user-1");
      expect(result.remaining).toBe(4); // Should be fresh
    });

    it("should not leak memory with many identifiers", () => {
      limiter = createRateLimiter({
        windowMs: 1000,
        maxRequests: 5,
        cleanupIntervalMs: 500,
      });

      // Create many entries
      for (let i = 0; i < 100; i++) {
        limiter.checkLimit(`user-${i}`);
      }

      // Advance time to trigger cleanup (2x window + cleanup interval)
      vi.advanceTimersByTime(3000);

      // All new requests should start fresh (old entries cleaned)
      for (let i = 0; i < 10; i++) {
        const result = limiter.checkLimit(`user-${i}`);
        expect(result.remaining).toBe(4); // Fresh start
      }
    });
  });

  describe("reset()", () => {
    beforeEach(() => {
      limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 3,
      });
    });

    it("should reset rate limit for specific identifier", () => {
      // Fill up the limit
      limiter.checkLimit("user-1");
      limiter.checkLimit("user-1");
      limiter.checkLimit("user-1");

      // Should be blocked
      const blocked = limiter.checkLimit("user-1");
      expect(blocked.success).toBe(false);

      // Reset the limit
      limiter.reset("user-1");

      // Should be allowed now
      const allowed = limiter.checkLimit("user-1");
      expect(allowed.success).toBe(true);
      expect(allowed.remaining).toBe(2); // Fresh start
    });

    it("should not affect other identifiers", () => {
      limiter.checkLimit("user-1");
      limiter.checkLimit("user-2");
      limiter.checkLimit("user-2");

      limiter.reset("user-1");

      // user-1 should be reset
      const r1 = limiter.checkLimit("user-1");
      expect(r1.remaining).toBe(2);

      // user-2 should still have history
      const r2 = limiter.checkLimit("user-2");
      expect(r2.remaining).toBe(0); // 3 total, 3rd request
    });

    it("should handle resetting non-existent identifier", () => {
      // Should not throw
      expect(() => limiter.reset("non-existent")).not.toThrow();

      // New request should work normally
      const result = limiter.checkLimit("non-existent");
      expect(result.success).toBe(true);
    });
  });

  describe("clear()", () => {
    beforeEach(() => {
      limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 3,
      });
    });

    it("should clear all rate limit data", () => {
      // Make requests for multiple users
      limiter.checkLimit("user-1");
      limiter.checkLimit("user-1");
      limiter.checkLimit("user-2");
      limiter.checkLimit("user-3");

      // Clear all data
      limiter.clear();

      // All users should start fresh
      const r1 = limiter.checkLimit("user-1");
      const r2 = limiter.checkLimit("user-2");
      const r3 = limiter.checkLimit("user-3");

      expect(r1.remaining).toBe(2); // Fresh start
      expect(r2.remaining).toBe(2);
      expect(r3.remaining).toBe(2);
    });

    it("should handle clearing empty store", () => {
      // Should not throw
      expect(() => limiter.clear()).not.toThrow();

      // Should work normally after
      const result = limiter.checkLimit("user-1");
      expect(result.success).toBe(true);
    });
  });

  describe("destroy()", () => {
    it("should stop the cleanup interval", () => {
      limiter = createRateLimiter({
        windowMs: 1000,
        maxRequests: 5,
        cleanupIntervalMs: 100,
      });

      // Destroy the limiter
      limiter.destroy();

      // Clear all timers to verify interval was cleared
      const timerCount = vi.getTimerCount();
      expect(timerCount).toBe(0);
    });

    it("should be safe to call multiple times", () => {
      limiter = createRateLimiter();

      expect(() => {
        limiter.destroy();
        limiter.destroy();
        limiter.destroy();
      }).not.toThrow();
    });
  });

  describe("getClientIp()", () => {
    it("should extract IP from x-forwarded-for header", () => {
      const headers = {
        "x-forwarded-for": "203.0.113.1, 198.51.100.1",
      };

      const ip = getClientIp(headers);
      expect(ip).toBe("203.0.113.1");
    });

    it("should handle single IP in x-forwarded-for", () => {
      const headers = {
        "x-forwarded-for": "203.0.113.1",
      };

      const ip = getClientIp(headers);
      expect(ip).toBe("203.0.113.1");
    });

    it("should handle array value for x-forwarded-for", () => {
      const headers = {
        "x-forwarded-for": ["203.0.113.1, 198.51.100.1", "192.0.2.1"],
      };

      const ip = getClientIp(headers);
      expect(ip).toBe("203.0.113.1");
    });

    it("should trim whitespace from x-forwarded-for", () => {
      const headers = {
        "x-forwarded-for": "  203.0.113.1  , 198.51.100.1",
      };

      const ip = getClientIp(headers);
      expect(ip).toBe("203.0.113.1");
    });

    it("should extract IP from x-real-ip header", () => {
      const headers = {
        "x-real-ip": "203.0.113.1",
      };

      const ip = getClientIp(headers);
      expect(ip).toBe("203.0.113.1");
    });

    it("should handle array value for x-real-ip", () => {
      const headers = {
        "x-real-ip": ["203.0.113.1", "198.51.100.1"],
      };

      const ip = getClientIp(headers);
      expect(ip).toBe("203.0.113.1");
    });

    it("should prefer x-forwarded-for over x-real-ip", () => {
      const headers = {
        "x-forwarded-for": "203.0.113.1",
        "x-real-ip": "198.51.100.1",
      };

      const ip = getClientIp(headers);
      expect(ip).toBe("203.0.113.1");
    });

    it("should fallback to 'unknown' when no headers present", () => {
      const headers = {};

      const ip = getClientIp(headers);
      expect(ip).toBe("unknown");
    });

    it("should fallback to 'unknown' when headers are empty", () => {
      const headers = {
        "x-forwarded-for": "",
        "x-real-ip": "",
      };

      const ip = getClientIp(headers);
      expect(ip).toBe("unknown");
    });

    it("should fallback to 'unknown' when headers are undefined", () => {
      const headers = {
        "x-forwarded-for": undefined,
        "x-real-ip": undefined,
      };

      const ip = getClientIp(headers);
      expect(ip).toBe("unknown");
    });

    it("should handle IPv6 addresses", () => {
      /* eslint-disable sonarjs/no-hardcoded-ip -- RFC 3849 documentation IP */
      const headers = {
        "x-forwarded-for": "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
      };

      const ip = getClientIp(headers);
      expect(ip).toBe("2001:0db8:85a3:0000:0000:8a2e:0370:7334");
      /* eslint-enable sonarjs/no-hardcoded-ip */
    });
  });

  describe("Edge cases", () => {
    beforeEach(() => {
      limiter = createRateLimiter({
        windowMs: 1000,
        maxRequests: 1,
      });
    });

    it("should handle limit of 1 request", () => {
      const r1 = limiter.checkLimit("user-1");
      expect(r1.success).toBe(true);
      expect(r1.remaining).toBe(0);

      const r2 = limiter.checkLimit("user-1");
      expect(r2.success).toBe(false);
      expect(r2.remaining).toBe(0);
    });

    it("should handle very short window (1ms)", () => {
      limiter.destroy();
      limiter = createRateLimiter({
        windowMs: 1,
        maxRequests: 5,
      });

      // Fill up the limit
      for (let i = 0; i < 5; i++) {
        limiter.checkLimit("user-1");
      }

      const blocked = limiter.checkLimit("user-1");
      expect(blocked.success).toBe(false);

      // Advance time past the window
      vi.advanceTimersByTime(2);

      const allowed = limiter.checkLimit("user-1");
      expect(allowed.success).toBe(true);
    });

    it("should handle very large window", () => {
      limiter.destroy();
      limiter = createRateLimiter({
        windowMs: 3600000, // 1 hour
        maxRequests: 100,
      });

      // Make a request
      const r1 = limiter.checkLimit("user-1");
      expect(r1.success).toBe(true);
      expect(r1.remaining).toBe(99);

      // Advance time by 30 minutes (still within window)
      vi.advanceTimersByTime(1800000);

      // Second request should still count against the limit
      const r2 = limiter.checkLimit("user-1");
      expect(r2.success).toBe(true);
      expect(r2.remaining).toBe(98);
    });

    it("should handle empty identifier string", () => {
      const result = limiter.checkLimit("");
      expect(result.success).toBe(true);
      expect(result.remaining).toBe(0);
    });

    it("should handle special characters in identifier", () => {
      const specialIds = [
        "user@example.com",
        "192.168.1.1:8080",
        "user-123_test.com",
        "::1",
      ];

      specialIds.forEach((id) => {
        limiter.reset(id); // Clear any previous state
        const result = limiter.checkLimit(id);
        expect(result.success).toBe(true);
      });
    });
  });
});
