import { getWyStackRuntimeConfig } from "./runtime";

export type AssistantSidebarEvent =
  | { type: "run-start" }
  | { type: "text-delta"; delta: string }
  | { type: "assistant-message"; text: string; stopReason?: string }
  | {
      type: "command-start";
      toolCallId: string;
      commandType: string;
      args: unknown;
    }
  | {
      type: "command-end";
      toolCallId: string;
      commandType: string;
      isError: boolean;
      result: unknown;
    }
  | { type: "tool-start"; toolCallId: string; toolName: string }
  | {
      type: "tool-end";
      toolCallId: string;
      toolName: string;
      isError: boolean;
    }
  | { type: "first-mutation"; draftId: string }
  | {
      type: "run-end";
      draftId: string;
      firstMutationObserved: boolean;
      terminationReason:
        | "completed"
        | "aborted"
        | "error"
        | "failureCap"
        | "oscillation";
    }
  | { type: "error"; message: string };

export interface AssistantRunRequest {
  prompt: string;
  artifact?: unknown;
  provider?: string;
  modelId?: string;
}

export interface RunAssistantPromptOptions extends AssistantRunRequest {
  signal?: AbortSignal;
  onEvent: (event: AssistantSidebarEvent) => void;
}

export function parseAssistantSseChunk(
  chunk: string,
  carry = "",
): { events: AssistantSidebarEvent[]; carry: string } {
  const text = carry + chunk;
  const parts = text.split(/\n\n/);
  const nextCarry = parts.pop() ?? "";
  const events = parts.flatMap((part) => {
    const data = part
      .split(/\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n");
    if (!data) return [];
    return [JSON.parse(data) as AssistantSidebarEvent];
  });
  return { events, carry: nextCarry };
}

export async function runAssistantPrompt({
  prompt,
  artifact,
  provider,
  modelId,
  signal,
  onEvent,
}: RunAssistantPromptOptions): Promise<void> {
  const runtime = getWyStackRuntimeConfig();
  const res = await fetch(`${runtime.url.replace(/\/$/, "")}/assistant/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(runtime.token ? { Authorization: `Bearer ${runtime.token}` } : {}),
    },
    body: JSON.stringify({ prompt, artifact, provider, modelId }),
    signal,
  });

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new Error(message);
  }
  if (!res.body) {
    throw new Error("Assistant run response did not include a stream");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let carry = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const parsed = parseAssistantSseChunk(
      decoder.decode(value, { stream: true }),
      carry,
    );
    carry = parsed.carry;
    for (const event of parsed.events) onEvent(event);
  }
  const tail = decoder.decode();
  if (tail) {
    const parsed = parseAssistantSseChunk(tail, carry);
    for (const event of parsed.events) onEvent(event);
  }
}

async function readErrorMessage(res: Response): Promise<string> {
  return res.status >= 500
    ? `Assistant service is unavailable (HTTP ${res.status})`
    : `Assistant request failed (HTTP ${res.status})`;
}
