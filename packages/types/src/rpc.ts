/**
 * RPC wire envelope for the DashFrame transport.
 *
 * Errors are tagged at the transport boundary using a small fixed vocabulary.
 * The codes intentionally match the categories called out in the v0.2
 * architecture (see CLAUDE.md): `connection | sql | validation | transport`.
 * `not_found` and `internal` are added because the transport itself needs
 * them — a missing handler is not a SQL/validation failure.
 *
 * Wire format is JSON. v0.2 ships JSON frames only; Arrow IPC is deferred.
 */

export type RpcErrorCode =
  | "connection"
  | "sql"
  | "validation"
  | "transport"
  | "not_found"
  | "internal";

export interface RpcError {
  code: RpcErrorCode;
  message: string;
  /**
   * Optional structured detail. Validation errors typically carry a list of
   * field issues here; SQL errors may carry the offending statement. Kept
   * loose because the renderer should treat it as opaque diagnostic data.
   */
  details?: unknown;
}

export function isRpcError(value: unknown): value is RpcError {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.code === "string" && typeof v.message === "string";
}

/**
 * Caller → handler request. `id` correlates the response across the IPC
 * boundary; the in-memory loopback also assigns one for symmetry and
 * test-debuggability even though direct dispatch doesn't need it.
 */
export interface RpcRequest {
  id: string;
  path: string;
  args?: unknown;
}

export type RpcResponse =
  | { id: string; ok: true; data: unknown }
  | { id: string; ok: false; error: RpcError };

/**
 * Subscription request. The handler is invoked once for the initial value,
 * then re-invoked on every `invalidate` event the host pushes back. Phase 1
 * leaves invalidation triggering up to whatever sits behind the transport
 * (today: nothing; later: WyStack's table-watch reactivity).
 */
export interface RpcSubscribeRequest {
  id: string;
  path: string;
  args?: unknown;
}

/**
 * Server → client push frame for an active subscription. `next` carries a
 * fresh result; `error` carries a terminal failure (the subscription is
 * considered closed once an error frame is delivered); `complete` is sent
 * by the host when it tears the subscription down (e.g. project closed).
 */
export type RpcSubscriptionEvent =
  | { subId: string; kind: "next"; data: unknown }
  | { subId: string; kind: "error"; error: RpcError }
  | { subId: string; kind: "complete" };
