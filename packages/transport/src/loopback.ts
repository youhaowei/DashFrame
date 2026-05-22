import type { TransportEndpoint, TransportMessageHandler } from "./interface";
import type { TransportMessage } from "./messages";

class LoopbackEndpoint implements TransportEndpoint {
  #handlers = new Set<TransportMessageHandler>();
  #closed = false;
  peer?: LoopbackEndpoint;

  send(message: TransportMessage): void {
    if (this.#closed || !this.peer || this.peer.#closed) return;
    const peer = this.peer;
    queueMicrotask(() => peer.deliver(message));
  }

  onMessage(handler: TransportMessageHandler): () => void {
    if (this.#closed) return () => {};
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }

  close(): void {
    this.#closed = true;
    this.#handlers.clear();
  }

  private deliver(message: TransportMessage): void {
    if (this.#closed) return;
    for (const handler of this.#handlers) {
      handler(message);
    }
  }
}

export function createLoopbackPair(): {
  client: TransportEndpoint;
  server: TransportEndpoint;
} {
  const client = new LoopbackEndpoint();
  const server = new LoopbackEndpoint();
  client.peer = server;
  server.peer = client;
  return { client, server };
}
