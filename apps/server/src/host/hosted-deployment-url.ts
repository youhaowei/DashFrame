/** Validate transport before creating a client or acquiring a Bearer assertion. */
export function validateHostedDeploymentUrl(
  value: string,
  allowInsecureLoopbackForTests = false,
): string {
  let url: URL;
  const authority = /^https?:\/\/([^/?#]+)\/?$/i.exec(value)?.[1];
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid hosted deployment URL");
  }
  if (
    !authority ||
    // oxlint-disable-next-line no-control-regex -- rejects control characters in the URL on purpose
    /[\u0000-\u0020\u007f\\]/.test(value) ||
    authority.includes("@") ||
    url.username ||
    url.password
  )
    throw new Error("Invalid hosted deployment URL");
  if (url.protocol === "https:") return url.origin;
  if (
    allowInsecureLoopbackForTests &&
    url.protocol === "http:" &&
    url.hostname === "127.0.0.1" &&
    /^127\.0\.0\.1(?::\d+)?$/.test(authority)
  )
    return url.origin;
  throw new Error("Hosted deployment requires HTTPS");
}
