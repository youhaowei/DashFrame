import { pathToFileURL } from "node:url";

interface RendererTrustOptions {
  dev: boolean;
  devUrl: string;
  productionFile: string;
}

/** Restrict privileged preload capabilities to the DashFrame renderer itself. */
export function isTrustedRendererUrl(
  value: string | undefined,
  options: RendererTrustOptions,
): boolean {
  if (!value) return false;

  let candidate: URL;
  try {
    candidate = new URL(value);
  } catch {
    return false;
  }

  if (options.dev) {
    try {
      return candidate.origin === new URL(options.devUrl).origin;
    } catch {
      return false;
    }
  }

  const expected = pathToFileURL(options.productionFile);
  return (
    candidate.protocol === "file:" &&
    candidate.origin === expected.origin &&
    candidate.host === expected.host &&
    candidate.pathname === expected.pathname
  );
}

export function assertTrustedRendererUrl(
  value: string | undefined,
  options: RendererTrustOptions,
): void {
  if (!isTrustedRendererUrl(value, options)) {
    throw new Error("Untrusted desktop renderer");
  }
}
