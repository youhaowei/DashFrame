import { describe, expect, it } from "vitest";

import { assertGoogleAuthorizationUrl } from "./oauth-external-url";

describe("assertGoogleAuthorizationUrl", () => {
  it("accepts the exact Google OAuth authorization endpoint", () => {
    expect(
      assertGoogleAuthorizationUrl(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id=client&state=state",
      ),
    ).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=client&state=state",
    );
  });

  it.each([
    "https://accounts.google.com/o/oauth2/v2/auth".replace("https", "http"),
    "https://accounts.google.com.evil.example/o/oauth2/v2/auth",
    "https://accounts.google.com/o/oauth2/auth",
    "https://accounts.google.com/o/oauth2/v2/auth#fragment",
    "https://user:password@accounts.google.com/o/oauth2/v2/auth",
  ])("rejects a URL outside the narrow authorization boundary: %s", (url) => {
    expect(() => assertGoogleAuthorizationUrl(url)).toThrow(
      "Google authorization URL is not allowed",
    );
  });

  it.each([undefined, null, 42, "not a url"])(
    "rejects a malformed value: %s",
    (value) => {
      expect(() => assertGoogleAuthorizationUrl(value)).toThrow();
    },
  );
});
