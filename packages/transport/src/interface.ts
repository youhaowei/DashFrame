import type { TransportMessage } from "./messages";

export type TransportMessageHandler = (message: TransportMessage) => void;

export type TransportEndpoint = {
  send(message: TransportMessage): void | Promise<void>;
  onMessage(handler: TransportMessageHandler): () => void;
  close(): void | Promise<void>;
};
