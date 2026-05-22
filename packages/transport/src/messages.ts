export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type TransportRequestType = "query" | "mutation" | "subscribe";

export type TransportRequestMessage = {
  type: TransportRequestType;
  id: string;
  path: string;
  args?: JsonValue;
};

export type TransportUnsubscribeMessage = {
  type: "unsubscribe";
  id: string;
};

export type ClientTransportMessage =
  | TransportRequestMessage
  | TransportUnsubscribeMessage;

export type TransportResultMessage = {
  type: "result";
  id: string;
  data: JsonValue;
};

export type TransportSubscribedMessage = {
  type: "subscribed";
  id: string;
};

export type TransportInvalidateMessage = {
  type: "invalidate";
  id: string;
  data?: JsonValue;
};

export type TransportErrorMessage = {
  type: "error";
  id?: string;
  code: string;
  message: string;
  issues?: JsonValue;
};

export type ServerTransportMessage =
  | TransportResultMessage
  | TransportSubscribedMessage
  | TransportInvalidateMessage
  | TransportErrorMessage;

export type TransportMessage = ClientTransportMessage | ServerTransportMessage;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  switch (typeof value) {
    case "string":
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object":
      if (Array.isArray(value)) {
        return value.every(isJsonValue);
      }
      return Object.values(value as Record<string, unknown>).every(isJsonValue);
    default:
      return false;
  }
}

export function parseClientMessage(value: unknown): ClientTransportMessage {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("Transport message must be an object with a type.");
  }

  if (value.type === "unsubscribe") {
    if (typeof value.id !== "string" || value.id.length === 0) {
      throw new Error("Transport unsubscribe message requires an id.");
    }
    return { type: "unsubscribe", id: value.id };
  }

  if (
    value.type !== "query" &&
    value.type !== "mutation" &&
    value.type !== "subscribe"
  ) {
    throw new Error(`Unsupported transport message type: ${value.type}`);
  }

  if (typeof value.id !== "string" || value.id.length === 0) {
    throw new Error("Transport request message requires an id.");
  }
  if (typeof value.path !== "string" || value.path.length === 0) {
    throw new Error("Transport request message requires a path.");
  }
  if ("args" in value && !isJsonValue(value.args)) {
    throw new Error("Transport request args must be JSON-serializable.");
  }

  return {
    type: value.type,
    id: value.id,
    path: value.path,
    args: value.args as JsonValue | undefined,
  };
}
