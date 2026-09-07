/**
 * Attach the host to an existing Convex Cloud deployment.
 *
 * This is the hosted counterpart of `startLocalConvex`. Desktop and local web
 * keep supervising their own backend process; a hosted DashFrame has no
 * writable place for one and no reason to want it, so it points at a Convex
 * Cloud deployment that CI has already pushed functions to.
 *
 * Three things deliberately do NOT happen here:
 *
 *   - No function deployment. `convex deploy` runs in the release workflow,
 *     from the commit being released, with a deploy key that never reaches the
 *     running container. A server that deploys its own functions on boot would
 *     make "what code is live" a function of restart timing.
 *   - No schema or data migration. Same reason.
 *   - **No deployment configuration.** In particular this does not write
 *     `DASHFRAME_AUTH_ISSUER` or `DASHFRAME_AUTH_JWKS` into the deployment's
 *     environment, which an earlier draft did. Two reasons it was wrong. It made
 *     the deployment's trust anchor a function of which container happened to
 *     boot last, so a rollback or a parallel restart could silently repoint who
 *     the backend trusts. And it required the running container to hold write
 *     authority over deployment configuration, widening the blast radius of the
 *     credential it already has to carry.
 *
 * The deployment's issuer and public JWKS are therefore configuration the
 * release pipeline publishes, from a constant issuer and a durable
 * deployment-owned signing key. This module only attaches to what is already
 * there.
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
  fetchImpl?: typeof fetch;
}

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
