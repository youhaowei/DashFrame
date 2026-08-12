const GOOGLE_AUTHORIZATION_ORIGIN = "https://accounts.google.com";
const GOOGLE_AUTHORIZATION_PATH = "/o/oauth2/v2/auth";

/**
 * Keep the preload capability narrower than a general-purpose URL launcher.
 * The renderer may only hand main the exact Google OAuth endpoint that the
 * server issues for GA4 setup.
 */
export function assertGoogleAuthorizationUrl(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Google authorization URL must be a string");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Google authorization URL is invalid");
  }

  if (
    url.origin !== GOOGLE_AUTHORIZATION_ORIGIN ||
    url.pathname !== GOOGLE_AUTHORIZATION_PATH ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error("Google authorization URL is not allowed");
  }

  return url.href;
}
