import { describe, expect, it } from "vitest";

import { _parseKeychainOAuthForTest } from "./keychain.js";

describe("readKeychainOAuth credential validation", () => {
  it("returns a structurally valid OAuth credential", () => {
    expect(
      _parseKeychainOAuthForTest({
        accessToken: "sk-ant-oat-access",
        refreshToken: "refresh-token",
        expiresAt: new Date().toISOString(),
      }),
    ).toEqual({
      accessToken: "sk-ant-oat-access",
      refreshToken: "refresh-token",
      expiresAt: expect.any(String),
    });
  });

  it("rejects a non-string accessToken from malformed keychain JSON", () => {
    expect(() =>
      _parseKeychainOAuthForTest({
        accessToken: 123,
        refreshToken: "refresh-token",
        expiresAt: Date.now() + 3_600_000,
      }),
    ).toThrow("claudeAiOauth.accessToken must be a string");
  });

  it("rejects a non-string refreshToken from malformed keychain JSON", () => {
    expect(() =>
      _parseKeychainOAuthForTest({
        accessToken: "sk-ant-oat-access",
        refreshToken: 456,
        expiresAt: Date.now() - 3_600_000,
      }),
    ).toThrow("claudeAiOauth.refreshToken must be a string");
  });

  it("rejects an invalid expiresAt field from malformed keychain JSON", () => {
    expect(() =>
      _parseKeychainOAuthForTest({
        accessToken: "sk-ant-oat-access",
        refreshToken: "refresh-token",
        expiresAt: { leaked: "not a timestamp" },
      }),
    ).toThrow("claudeAiOauth.expiresAt must be a number or string");
  });
});
