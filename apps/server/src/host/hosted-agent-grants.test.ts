import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ConvexError } from "convex/values";
import { createHostedAgentGrants } from "./hosted-agent-grants";

const mutation = vi.fn();

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    setAuth() {}
    mutation = mutation;
  },
}));

const user = { userId: "user_01", expiresAt: Date.now() + 60_000 };

function grants() {
  return createHostedAgentGrants({
    deploymentUrl: "https://deployment.example.test",
    tokens: { agentGrant: () => ({ token: "t", expiresAt: 0 }) as never },
  });
}

describe("hosted agent grants", () => {
  beforeEach(() => mutation.mockReset());

  it("returns the active grant", async () => {
    mutation.mockResolvedValue({ grantId: "g1", permissions: [] });
    expect(await grants().ensure(user, "w1", "oauth:claude")).toEqual({
      status: "active",
      grantId: "g1",
    });
  });

  it("reports a revoked grant and any other permanent denial without throwing", async () => {
    mutation.mockRejectedValueOnce(new ConvexError("Agent grant revoked"));
    expect(await grants().ensure(user, "w1", "oauth:claude")).toEqual({
      status: "revoked",
    });
    mutation.mockRejectedValueOnce(
      new ConvexError("Agent grant workspace mismatch"),
    );
    expect(await grants().ensure(user, "w1", "oauth:claude")).toEqual({
      status: "refused",
    });
  });

  it("throws what a retry can clear: an allocation conflict or a transport fault", async () => {
    mutation.mockRejectedValueOnce(
      new ConvexError("Agent grant allocation conflict; retry"),
    );
    await expect(grants().ensure(user, "w1", "oauth:claude")).rejects.toThrow(
      ConvexError,
    );
    mutation.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(grants().ensure(user, "w1", "oauth:claude")).rejects.toThrow(
      TypeError,
    );
  });
});
