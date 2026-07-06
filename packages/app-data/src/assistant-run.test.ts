import { describe, expect, it } from "vitest";

import { parseAssistantSseChunk } from "./assistant-run";

describe("assistant SSE parsing", () => {
  it("parses complete events and preserves partial carry", () => {
    const first = parseAssistantSseChunk(
      'data: {"type":"run-start"}\n\n' +
        'data: {"type":"text-delta","delta":"hel',
    );

    expect(first.events).toEqual([{ type: "run-start" }]);
    expect(first.carry).toBe('data: {"type":"text-delta","delta":"hel');

    const second = parseAssistantSseChunk('lo"}\n\n', first.carry);

    expect(second.events).toEqual([{ type: "text-delta", delta: "hello" }]);
    expect(second.carry).toBe("");
  });

  it("handles multi-line data payloads", () => {
    const parsed = parseAssistantSseChunk(
      'data: {"type":"assistant-message",\n' +
        'data: "text":"done","stopReason":"stop"}\n\n',
    );

    expect(parsed.events).toEqual([
      { type: "assistant-message", text: "done", stopReason: "stop" },
    ]);
  });
});
