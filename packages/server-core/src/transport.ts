import {
  parseClientMessage,
  type JsonValue,
  type ServerTransportMessage,
  type TransportEndpoint,
  type TransportErrorMessage,
} from "@dashframe/transport";

export type TransportProcedureContext = {
  subscriptionId?: string;
};

export type TransportProcedureResult = {
  data: JsonValue;
  tablesRead?: readonly string[];
  tablesWritten?: readonly string[];
};

export type TransportProcedure = (
  args: JsonValue | undefined,
  context: TransportProcedureContext,
) => Promise<TransportProcedureResult> | TransportProcedureResult;

export type TransportRegistry = {
  queries?: Record<string, TransportProcedure>;
  mutations?: Record<string, TransportProcedure>;
};

export type TransportDispatcher = {
  dispose(): void;
};

type Subscription = {
  id: string;
  path: string;
  args: JsonValue | undefined;
  tablesRead: Set<string>;
};

function errorMessage(
  message: string,
  options: { id?: string; code?: string; issues?: JsonValue } = {},
): TransportErrorMessage {
  return {
    type: "error",
    id: options.id,
    code: options.code ?? "BAD_REQUEST",
    message,
    issues: options.issues,
  };
}

function intersects(left: Set<string>, right: readonly string[]): boolean {
  return right.some((value) => left.has(value));
}

export function attachTransportDispatcher(
  endpoint: TransportEndpoint,
  registry: TransportRegistry,
): TransportDispatcher {
  const subscriptions = new Map<string, Subscription>();

  async function send(message: ServerTransportMessage): Promise<void> {
    await endpoint.send(message);
  }

  async function runQuery(
    id: string,
    path: string,
    args: JsonValue | undefined,
    subscriptionId?: string,
  ): Promise<TransportProcedureResult | null> {
    const procedure = registry.queries?.[path];
    if (!procedure) {
      await send(
        errorMessage(`Unknown query: ${path}`, { id, code: "NOT_FOUND" }),
      );
      return null;
    }

    try {
      return await procedure(args, { subscriptionId });
    } catch (err) {
      await send(
        errorMessage(err instanceof Error ? err.message : String(err), {
          id,
          code: "QUERY_FAILED",
        }),
      );
      return null;
    }
  }

  async function runMutation(
    id: string,
    path: string,
    args: JsonValue | undefined,
  ): Promise<void> {
    const procedure = registry.mutations?.[path];
    if (!procedure) {
      await send(
        errorMessage(`Unknown mutation: ${path}`, { id, code: "NOT_FOUND" }),
      );
      return;
    }

    let result: TransportProcedureResult;
    try {
      result = await procedure(args, {});
    } catch (err) {
      await send(
        errorMessage(err instanceof Error ? err.message : String(err), {
          id,
          code: "MUTATION_FAILED",
        }),
      );
      return;
    }

    await send({ type: "result", id, data: result.data });
    const tablesWritten = result.tablesWritten ?? [];
    for (const subscription of subscriptions.values()) {
      if (intersects(subscription.tablesRead, tablesWritten)) {
        const queryResult = await runQuery(
          subscription.id,
          subscription.path,
          subscription.args,
          subscription.id,
        );
        if (queryResult) {
          subscription.tablesRead = new Set(queryResult.tablesRead ?? []);
          await send({
            type: "invalidate",
            id: subscription.id,
            data: queryResult.data,
          });
        }
      }
    }
  }

  async function handleMessage(value: unknown): Promise<void> {
    let message;
    try {
      message = parseClientMessage(value);
    } catch (err) {
      await send(
        errorMessage(err instanceof Error ? err.message : String(err), {
          code: "INVALID_MESSAGE",
        }),
      );
      return;
    }

    if (message.type === "unsubscribe") {
      subscriptions.delete(message.id);
      return;
    }

    if (message.type === "query") {
      const result = await runQuery(message.id, message.path, message.args);
      if (result) {
        await send({ type: "result", id: message.id, data: result.data });
      }
      return;
    }

    if (message.type === "mutation") {
      await runMutation(message.id, message.path, message.args);
      return;
    }

    const result = await runQuery(
      message.id,
      message.path,
      message.args,
      message.id,
    );
    if (!result) return;
    subscriptions.set(message.id, {
      id: message.id,
      path: message.path,
      args: message.args,
      tablesRead: new Set(result.tablesRead ?? []),
    });
    await send({ type: "subscribed", id: message.id });
  }

  const unsubscribe = endpoint.onMessage((message) => {
    void handleMessage(message);
  });

  return {
    dispose() {
      subscriptions.clear();
      unsubscribe();
    },
  };
}
