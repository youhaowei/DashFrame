import { useEffect, useLayoutEffect, useMemo, useRef } from "react";

export interface WebMCPToolExecutionOptions {
  signal: AbortSignal;
}

export interface WebMCPToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
  };
  execute: (
    input: Record<string, unknown>,
    options?: WebMCPToolExecutionOptions,
  ) => unknown | Promise<unknown>;
}

export interface WebMCPModelContext {
  registerTool(
    tool: WebMCPToolDefinition,
    options?: { signal?: AbortSignal },
  ): void | Promise<void>;
}

declare global {
  interface Document {
    modelContext?: WebMCPModelContext;
  }
}

function descriptorKey(tools: readonly WebMCPToolDefinition[]): string {
  return JSON.stringify(
    tools.map(({ execute: _execute, ...descriptor }) => descriptor),
  );
}

function executeCurrentTool(
  toolsRef: { current: readonly WebMCPToolDefinition[] },
  name: string,
  input: Record<string, unknown>,
  options?: WebMCPToolExecutionOptions,
) {
  const current = toolsRef.current.find((candidate) => candidate.name === name);
  if (!current) throw new Error(`WebMCP tool ${name} is unavailable.`);
  return current.execute(input, options);
}

/** Register one stable tool set for a React mount and abort it on unmount. */
export function useWebMCPTools(tools: readonly WebMCPToolDefinition[]): void {
  const toolsRef = useRef(tools);
  useLayoutEffect(() => {
    toolsRef.current = tools;
  }, [tools]);

  const key = descriptorKey(tools);
  const registeredTools = useMemo(
    () =>
      tools.map(({ execute: _execute, ...descriptor }) => ({
        ...descriptor,
        execute: (
          input: Record<string, unknown>,
          options?: WebMCPToolExecutionOptions,
        ) => executeCurrentTool(toolsRef, descriptor.name, input, options),
      })),
    // Executors stay live through toolsRef; only descriptor changes register.
    // oxlint-disable-next-line react-hooks-js/exhaustive-deps
    [key],
  );

  useEffect(() => {
    const modelContext = document.modelContext;
    if (typeof modelContext?.registerTool !== "function") return;

    const controller = new AbortController();
    for (const tool of registeredTools) {
      Promise.resolve(
        modelContext.registerTool(tool, { signal: controller.signal }),
      ).catch((error: unknown) => {
        if (!controller.signal.aborted)
          console.warn(`[dashframe] Could not register ${tool.name}`, error);
      });
    }
    return () => controller.abort();
  }, [registeredTools]);
}
