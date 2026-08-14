import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { parseAssistantSseChunk, runAssistantPrompt } from "./assistant-run";

vi.mock("./runtime", () => ({
  getWyStackRuntimeConfig: () => ({ url: "http://localhost:4000" }),
}));

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

describe("runAssistantPrompt error paths", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not expose a server error message on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "Unknown Anthropic model id: nope" },
          {
            status: 400,
          },
        ),
      ),
    );

    await expect(
      runAssistantPrompt({ prompt: "hi", onEvent: () => {} }),
    ).rejects.toThrow("Assistant request failed (HTTP 400)");
  });

  it("falls back to an HTTP-status message when the error body is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 502 })),
    );

    await expect(
      runAssistantPrompt({ prompt: "hi", onEvent: () => {} }),
    ).rejects.toThrow("Assistant service is unavailable (HTTP 502)");
  });

  it("does not expose an HTML proxy error body to the assistant timeline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            "<!DOCTYPE html><html><head><title>502 - Bad Gateway</title></head></html>",
            {
              status: 502,
              headers: { "Content-Type": "text/html" },
            },
          ),
      ),
    );

    await expect(
      runAssistantPrompt({ prompt: "hi", onEvent: () => {} }),
    ).rejects.toThrow("Assistant service is unavailable (HTTP 502)");
  });

  it("throws when an OK response carries no stream body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );

    await expect(
      runAssistantPrompt({ prompt: "hi", onEvent: () => {} }),
    ).rejects.toThrow("Assistant run response did not include a stream");
  });
});
