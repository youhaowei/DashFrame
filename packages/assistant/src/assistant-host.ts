import type { GraphReader } from "./read/port.js";

/**
 * The command envelope the host dispatches through its normal mutation registry.
 * The assistant package owns the shape but never imports the server.
 */
export interface AssistantCommand {
  path: string;
  args: unknown;
  id?: string;
}

export interface AssistantCommandResult {
  id?: string;
  value: unknown;
}

/**
 * Single host port for assistant runs.
 *
 * The host owns draft lifecycle, command lowering, and draft-scoped reads. The
 * assistant owns the pi loop and tools, consuming only this port.
 */
export interface AssistantHost {
  open(): Promise<string>;
  append(
    draftId: string,
    batch: AssistantCommand[],
    context?: Record<string, unknown>,
  ): Promise<AssistantCommandResult[]>;
  discard(draftId: string): Promise<void>;
  buildCommand(type: string, args: unknown): AssistantCommand;
  reader(draftId: string): GraphReader;
}
