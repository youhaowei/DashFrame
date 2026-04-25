/**
 * `TransportError` is the single boundary type the transport surfaces to
 * callers. Wrapping every cross-process failure in it gives the renderer
 * (and same-process callers) one `instanceof` check rather than a discrim-
 * inated union scattered through call sites.
 *
 * `code` is one of the tagged values from `RpcError`; the original
 * `RpcError` is exposed verbatim so consumers that want richer treatment
 * (e.g. surfacing validation `details`) can reach in without parsing
 * `message`.
 */
import type { RpcError, RpcErrorCode } from "@dashframe/types";

export class TransportError extends Error {
  readonly code: RpcErrorCode;
  readonly details: unknown;
  readonly rpcError: RpcError;

  constructor(error: RpcError) {
    super(error.message);
    this.name = "TransportError";
    this.code = error.code;
    this.details = error.details;
    this.rpcError = error;
  }
}

/**
 * Normalize an unknown thrown value into an `RpcError`. Used by the router
 * and adapters when a handler throws or rejects: anything that isn't already
 * a structured `RpcError` becomes `internal` with the message preserved.
 */
export function toTransportError(err: unknown): RpcError {
  if (err instanceof TransportError) return err.rpcError;
  if (err instanceof Error) {
    return { code: "internal", message: err.message };
  }
  return { code: "internal", message: String(err) };
}
