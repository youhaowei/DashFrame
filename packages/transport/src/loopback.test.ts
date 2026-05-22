import { describe, expect, it } from "bun:test";

import { createLoopbackPair } from "./loopback";
import type { TransportMessage } from "./messages";
import { isJsonValue, parseClientMessage } from "./messages";

function nextMessage(received: TransportMessage[]): Promise<TransportMessage> {
  return new Promise((resolve) => {
    const poll = () => {
      const message = received.shift();
      if (message) {
        resolve(message);
        return;
      }
      setTimeout(poll, 0);
    };
    poll();
  });
}

describe("createLoopbackPair", () => {
  it("delivers messages in both directions asynchronously", async () => {
    const { client, server } = createLoopbackPair();
    const serverMessages: TransportMessage[] = [];
    const clientMessages: TransportMessage[] = [];
    server.onMessage((message) => serverMessages.push(message));
    client.onMessage((message) => clientMessages.push(message));

    client.send({ type: "query", id: "q1", path: "project.info" });
    server.send({ type: "result", id: "q1", data: { ok: true } });

    expect(await nextMessage(serverMessages)).toEqual({
      type: "query",
      id: "q1",
      path: "project.info",
    });
    expect(await nextMessage(clientMessages)).toEqual({
      type: "result",
      id: "q1",
      data: { ok: true },
    });
  });

  it("stops delivering messages after unsubscribe and close", async () => {
    const { client, server } = createLoopbackPair();
    let count = 0;
    const unsubscribe = server.onMessage(() => count++);

    unsubscribe();
    client.send({ type: "query", id: "q1", path: "project.info" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(count).toBe(0);

    server.onMessage(() => count++);
    server.close();
    client.send({ type: "query", id: "q2", path: "project.info" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(count).toBe(0);
  });
});

describe("message validation", () => {
  it("accepts JSON strings, booleans, numbers, arrays, and records", () => {
    expect(isJsonValue("value")).toBe(true);
    expect(isJsonValue(true)).toBe(true);
    expect(isJsonValue(1)).toBe(true);
    expect(isJsonValue(["value", false, 2])).toBe(true);
    expect(isJsonValue({ name: "DashFrame", ok: true })).toBe(true);
  });

  it("parses request messages with object args", () => {
    expect(
      parseClientMessage({
        type: "mutation",
        id: "m1",
        path: "project.rename",
        args: { name: "After" },
      }),
    ).toEqual({
      type: "mutation",
      id: "m1",
      path: "project.rename",
      args: { name: "After" },
    });
  });
});
