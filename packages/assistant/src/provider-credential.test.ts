import { describe, expect, it, vi } from "vitest";

import { ensureAnthropicCredential } from "./provider-credential";

describe("ensureAnthropicCredential", () => {
  it("leaves the environment untouched when ANTHROPIC_OAUTH_TOKEN is already set", async () => {
    const env = { ANTHROPIC_OAUTH_TOKEN: "existing-oauth-token" };
    const getToken = vi.fn();

    await ensureAnthropicCredential({ env, getToken });

    expect(getToken).not.toHaveBeenCalled();
    expect(env.ANTHROPIC_OAUTH_TOKEN).toBe("existing-oauth-token");
  });

  it("leaves the environment untouched when ANTHROPIC_API_KEY is already set", async () => {
    const env: Record<string, string | undefined> = {
      ANTHROPIC_API_KEY: "existing-api-key",
    };
    const getToken = vi.fn();

    await ensureAnthropicCredential({ env, getToken });

    expect(getToken).not.toHaveBeenCalled();
    expect(env.ANTHROPIC_OAUTH_TOKEN).toBeUndefined();
  });

  it("resolves and sets ANTHROPIC_OAUTH_TOKEN from the injected token source when neither env var is set", async () => {
    const env: Record<string, string | undefined> = {};
    const getToken = vi.fn(async () => "resolved-token-from-keychain");

    await ensureAnthropicCredential({ env, getToken });

    expect(getToken).toHaveBeenCalledOnce();
    expect(env.ANTHROPIC_OAUTH_TOKEN).toBe("resolved-token-from-keychain");
  });

  it("treats a blank-string env value as unset and still resolves via the token source", async () => {
    const env: Record<string, string | undefined> = {
      ANTHROPIC_OAUTH_TOKEN: "   ",
      ANTHROPIC_API_KEY: "",
    };
    const getToken = vi.fn(async () => "resolved-token");

    await ensureAnthropicCredential({ env, getToken });

    expect(getToken).toHaveBeenCalledOnce();
    expect(env.ANTHROPIC_OAUTH_TOKEN).toBe("resolved-token");
  });

  it("prints a fixed, secret-free hint and leaves env unset when the token source fails", async () => {
    const env: Record<string, string | undefined> = {};
    const getToken = vi.fn(async () => {
      throw new Error("keychain says: sk-ant-oat-should-never-appear");
    });
    const log = vi.fn();

    await ensureAnthropicCredential({ env, getToken, log });

    expect(env.ANTHROPIC_OAUTH_TOKEN).toBeUndefined();
    expect(log).toHaveBeenCalledOnce();
    const [message] = log.mock.calls[0]!;
    expect(message).not.toContain("sk-ant-oat-should-never-appear");
    expect(message).toContain("ANTHROPIC_API_KEY");
  });
});
