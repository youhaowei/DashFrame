/**
 * @dashframe/types — wire-shape contracts shared across the desktop process
 * boundary (main, preload, renderer) and the future `dashframe serve` web
 * client.
 *
 * Keep this package zero-dependency and runtime-free: every consumer (Node,
 * Electron preload sandbox, browser) must be able to import these types
 * without dragging in heavy modules.
 */

export { isRpcError } from "./rpc";
export type {
  RpcError,
  RpcErrorCode,
  RpcRequest,
  RpcResponse,
  RpcSubscribeRequest,
  RpcSubscriptionEvent,
} from "./rpc";

export type { ProjectInfo } from "./project";
