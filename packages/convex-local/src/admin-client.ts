/**
 * Admin-authenticated internal-function client, shared by every Convex backend
 * the host can be attached to.
 *
 * The wire contract is the same whether the deployment is the local backend
 * this package supervises or a Convex Cloud deployment: POST
 * `/api/{query,mutation}` with `Authorization: Convex <admin key>`, a
 * `convex_encoded_json` body, and a `{status, value}` envelope in the reply.
 * Keeping one implementation means the cloud path cannot drift from the local
 * one in argument encoding, error handling or credential redaction.
 */
import { getFunctionName } from "convex/server";
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import { convexToJson, jsonToConvex } from "convex/values";
import type { Value } from "convex/values";

export type InternalQuery = FunctionReference<"query", "internal">;
export type InternalMutation = FunctionReference<"mutation", "internal">;

export interface InternalClient {
  query<Q extends InternalQuery>(
    query: Q,
    args: FunctionArgs<Q>,
  ): Promise<FunctionReturnType<Q>>;
  mutation<M extends InternalMutation>(
    mutation: M,
    args: FunctionArgs<M>,
  ): Promise<FunctionReturnType<M>>;
}

export interface AdminInternalClientOptions {
  /** Deployment origin, without a trailing `/api` segment. */
  url: string;
  /** Admin key (local backend) or deploy key (Convex Cloud). */
  adminKey: string;
  /** Operator-facing name used in failure messages. */
  label: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Build a client that can call *internal* Convex functions only.
 *
 * The type parameters accept nothing else, which is the point: this credential
 * is the host's private capability and must never be able to invoke a public
 * application function on the caller's behalf.
 */
export function createAdminInternalClient(
  options: AdminInternalClientOptions,
): InternalClient {
  const endpoint = options.url.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const call = async (
    type: "query" | "mutation",
    reference: InternalQuery | InternalMutation,
    args: Value,
  ) => {
    const request = options.fetchImpl ?? fetch;
    const response = await request(`${endpoint}/api/${type}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Convex ${options.adminKey}`,
      },
      body: JSON.stringify({
        path: getFunctionName(reference),
        args: [convexToJson(args)],
        format: "convex_encoded_json",
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Parse defensively rather than with `response.json()`. A deployment does
    // not always answer with JSON: a gateway 502, a proxy error page, or a
    // rate-limit body are all plain text, and letting `json()` throw would
    // surface `Unexpected token 'o'` to the caller instead of the status that
    // actually explains the failure — and would put a fragment of the response
    // body into the message.
    let result: {
      status?: string;
      value?: Parameters<typeof jsonToConvex>[0];
    } = {};
    try {
      result = JSON.parse(await response.text()) as typeof result;
    } catch {
      result = {};
    }
    if (
      !response.ok ||
      result.status !== "success" ||
      result.value === undefined
    ) {
      // The admin key is never interpolated into this message: a deployment
      // diagnostic is routinely logged, and a leaked deploy key is full
      // control of the deployment.
      throw new Error(
        `${options.label} internal ${type} failed (${response.status}).`,
      );
    }
    return jsonToConvex(result.value);
  };
  return {
    query: async <Q extends InternalQuery>(
      reference: Q,
      args: FunctionArgs<Q>,
    ) => (await call("query", reference, args)) as FunctionReturnType<Q>,
    mutation: async <M extends InternalMutation>(
      reference: M,
      args: FunctionArgs<M>,
    ) => (await call("mutation", reference, args)) as FunctionReturnType<M>,
  };
}
