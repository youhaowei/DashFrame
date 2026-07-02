import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { measureAssistantStream } from "./provider-measurement";

function message(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "ok" }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-haiku-4-5",
    usage: {
      input: 10,
      output: 4,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 14,
      cost: {
        input: 0.00001,
        output: 0.00002,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0.00003,
      },
    },
    stopReason: "stop",
    timestamp: Date.now(),
    ...overrides,
  };
}

function throwingStream(error: Error): AssistantMessageEventStream {
  return {
    [Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
      return {
        next: async () => Promise.reject(error),
      };
    },
    result: async () => {
      throw new Error("result should not be called");
    },
  } as unknown as AssistantMessageEventStream;
}

describe("provider measurement harness", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records streaming latency, text deltas, stop reason, and usage", async () => {
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(125)
      .mockReturnValueOnce(170);

    const stream = createAssistantMessageEventStream();
    const final = message();
    stream.push({ type: "start", partial: final });
    stream.push({ type: "text_start", contentIndex: 0, partial: final });
    stream.push({
      type: "text_delta",
      contentIndex: 0,
      delta: "ok",
      partial: final,
    });
    stream.push({
      type: "text_end",
      contentIndex: 0,
      content: "ok",
      partial: final,
    });
    stream.push({ type: "done", reason: "stop", message: final });

    const result = await measureAssistantStream({
      label: "fake",
      provider: "anthropic",
      modelId: "claude-haiku-4-5",
      stream,
    });

    expect(result.ok).toBe(true);
    expect(result.textDeltaCount).toBe(1);
    expect(result.outputPreview).toBe("ok");
    expect(result.stopReason).toBe("stop");
    expect(result.usage?.totalTokens).toBe(14);
    expect(result.timeToFirstTokenMs).toBe(25);
    expect(result.durationMs).toBe(70);
  });

  it("reports stream error events as failed measurements", async () => {
    const stream = createAssistantMessageEventStream();
    const final = message({
      stopReason: "error",
      errorMessage: "no credentials",
    });
    const later = message({
      stopReason: "stop",
      errorMessage: undefined,
    });
    stream.push({ type: "error", reason: "error", error: final });
    stream.push({
      type: "text_delta",
      contentIndex: 0,
      delta: "should not be included",
      partial: later,
    });
    stream.push({ type: "done", reason: "stop", message: later });

    const result = await measureAssistantStream({
      label: "fake-error",
      provider: "amazon-bedrock",
      modelId: "amazon.nova-micro-v1:0",
      stream,
    });

    expect(result.ok).toBe(false);
    expect(result.stopReason).toBe("error");
    expect(result.error).toBe("no credentials");
    expect(result.outputPreview).toBe("");
  });

  it("reports thrown stream failures as failed measurements", async () => {
    const result = await measureAssistantStream({
      label: "fake-throw",
      provider: "anthropic",
      modelId: "claude-haiku-4-5",
      stream: throwingStream(new Error("stream exploded")),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("stream exploded");
    expect(result.outputPreview).toBe("");
    expect(result.textDeltaCount).toBe(0);
    expect(result.timeToFirstTokenMs).toBeNull();
  });
});
