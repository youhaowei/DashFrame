import { describe, expect, it } from "vite-plus/test";
import {
  DeploymentFailure,
  isTransientDeploymentDiagnostic,
  retryDeployment,
} from "./deployment-retry.js";

const schemaTimeout =
  "Error fetching POST http://127.0.0.1:62065/api/deploy2/start_push 400 Bad Request: Error: Hit an error while pushing: Hit an error while evaluating your schema: Function execution timed out (maximum duration: 1s).";
const rateLimited =
  "Error fetching POST http://127.0.0.1:62065/api/deploy2/start_push 429 Too Many Requests: Try again later";

describe("bounded local deployment retries", () => {
  it.each([schemaTimeout, rateLimited])(
    "retries a recognized cold-start failure after cleanup",
    async (diagnostic) => {
      const events: string[] = [];
      const result = await retryDeployment(
        async () => {
          events.push("attempt");
          try {
            if (events.length === 1)
              throw new DeploymentFailure(
                diagnostic,
                isTransientDeploymentDiagnostic(diagnostic),
              );
            return "deployed";
          } finally {
            events.push("stopped");
          }
        },
        async (ms) => {
          events.push(`wait:${ms}`);
        },
      );
      expect(result).toBe("deployed");
      expect(events).toEqual([
        "attempt",
        "stopped",
        "wait:1000",
        "attempt",
        "stopped",
      ]);
    },
  );

  it("stops after three attempts and preserves the last redacted diagnostic", async () => {
    let attempts = 0;
    const waits: number[] = [];
    await expect(
      retryDeployment(
        async () => {
          attempts++;
          throw new DeploymentFailure(`failure ${attempts}: [redacted]`, true);
        },
        async (ms) => {
          waits.push(ms);
        },
      ),
    ).rejects.toThrow("failure 3: [redacted]");
    expect(attempts).toBe(3);
    expect(waits).toEqual([1000, 2000]);
  });

  it.each([
    "Error fetching POST http://127.0.0.1:62065/api/deploy2/start_push 400 Bad Request: Invalid module path",
    "Hit an error while evaluating your schema: Validation failed for document 429",
    "Function execution timed out (maximum duration: 1s).",
    "Error fetching POST http://example.com/api/deploy2/start_push 429 Too Many Requests",
    "Local Convex function deployment timed out.",
  ])(
    "does not retry validation, unrelated timeout, or non-local errors",
    async (diagnostic) => {
      expect(isTransientDeploymentDiagnostic(diagnostic)).toBe(false);
      let attempts = 0;
      await expect(
        retryDeployment(async () => {
          attempts++;
          throw new DeploymentFailure(
            diagnostic,
            isTransientDeploymentDiagnostic(diagnostic),
          );
        }),
      ).rejects.toThrow(diagnostic);
      expect(attempts).toBe(1);
    },
  );

  it("does not retry unexpected operational errors", async () => {
    let attempts = 0;
    await expect(
      retryDeployment(async () => {
        attempts++;
        throw new Error("spawn failed");
      }),
    ).rejects.toThrow("spawn failed");
    expect(attempts).toBe(1);
  });
});
