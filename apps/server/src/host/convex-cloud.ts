/**
 * Attach the host to an existing Convex Cloud deployment.
 *
 * This is the hosted counterpart of `startLocalConvex`. Desktop and local web
 * keep supervising their own backend process; a hosted DashFrame has no
 * writable place for one and no reason to want it, so it points at a Convex
 * Cloud deployment that CI has already pushed functions to.
 *
 * Two things deliberately do NOT happen here:
 *
 *   - No function deployment. `convex deploy` runs in the release workflow,
 *     from the commit being released, with a deploy key that never reaches the
 *     running container. A server that deploys its own functions on boot would
 *     make "what code is live" a function of restart timing.
 *   - No schema or data migration. Same reason.
 *
 * What *does* happen is the auth handshake: the host is the JWT issuer for the
 * renderer, so the deployment has to be told this host's issuer and JWKS before
 * any renderer token will verify.
 */
import { createAdminInternalClient } from "@dashframe/convex-local";
import type { InternalClient } from "@dashframe/convex-local";

import { isLoopbackHost } from "../bind-host";

/** The subset of `LocalConvex` the host actually consumes. */
export interface ConvexBackend {
  url: string;
  internalClient: InternalClient;
  closed: Promise<void>;
  stop(): Promise<void>;
}

export interface ConvexCloudOptions {
  /** Deployment origin, e.g. `https://tidy-otter-123.convex.cloud`. */
  url: string;
  /** Convex deploy key for that deployment. Admin capability — never logged. */
  adminKey: string;
  auth: { issuer: string; jwksDataUri: string; audience: "dashframe" };
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const ENV_TIMEOUT_MS = 15_000;

/**
 * Reject anything that is not a plaintext-safe deployment origin.
 *
 * A Convex deploy key is bearer-equivalent admin authority over the whole
 * deployment, and this function is the only place that decides where it gets
 * sent. `http:` is permitted solely for loopback, which is how the tests point
 * this code at a stub server; any other cleartext target would put the key on
 * the wire.
 */
export function assertConvexCloudUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Convex deployment URL is not a URL: ${raw}`);
  }
  if (url.protocol === "https:") return url;
  if (url.protocol === "http:" && isLoopbackHost(url.hostname)) return url;
  throw new Error(
    "Convex deployment URL must be https (an http URL is accepted only on loopback, for tests)",
  );
}

/**
 * Point the deployment's custom-JWT provider at this host's signing key.
 *
 * `convex/auth.config.ts` reads both values from the deployment environment, so
 * without this call every renderer token is rejected and the app never leaves
 * its "Connecting…" state. It is idempotent — writing the same values again is
 * a no-op from the deployment's perspective — which matters because a container
 * restart runs it again.
 */
async function configureDeploymentAuth(
  options: ConvexCloudOptions,
  endpoint: string,
): Promise<void> {
  const request = options.fetchImpl ?? fetch;
  const response = await request(
    `${endpoint}/api/update_environment_variables`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Convex ${options.adminKey}`,
      },
      body: JSON.stringify({
        changes: [
          { name: "DASHFRAME_AUTH_ISSUER", value: options.auth.issuer },
          { name: "DASHFRAME_AUTH_JWKS", value: options.auth.jwksDataUri },
        ],
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? ENV_TIMEOUT_MS),
    },
  );
  await response.body?.cancel();
  if (!response.ok) {
    throw new Error(
      `Could not configure Convex Cloud authentication (${response.status}). ` +
        "Check that DASHFRAME_CONVEX_ADMIN_KEY is a deploy key for DASHFRAME_CONVEX_URL.",
    );
  }
}

/**
 * Connect to a Convex Cloud deployment and return it in the same shape the
 * host already consumes from the local backend.
 *
 * `stop()` is not a no-op purely for symmetry: `closed` is awaited by callers
 * that want to know the backend went away, and resolving it on stop keeps a
 * hosted shutdown from hanging on a promise that can never settle.
 */
export async function connectConvexCloud(
  options: ConvexCloudOptions,
): Promise<ConvexBackend> {
  const url = assertConvexCloudUrl(options.url);
  const endpoint = url.toString().replace(/\/+$/, "");
  await configureDeploymentAuth(options, endpoint);
  let resolveClosed: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  return {
    url: endpoint,
    internalClient: createAdminInternalClient({
      url: endpoint,
      adminKey: options.adminKey,
      label: "Convex Cloud",
      fetchImpl: options.fetchImpl,
    }),
    closed,
    async stop() {
      resolveClosed();
    },
  };
}
