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
  interface Navigator {
    modelContext?: WebMCPModelContext;
  }
}

/**
 * Both spellings are live, so we cannot pick one.
 *
 * The spec moved the entry point from `navigator` to `document` — tools belong
 * to a page, not to the browser — and Chrome deprecated `navigator.modelContext`
 * in Chrome 150. But the WebMCP origin trial (Chrome 149-156) still ships the
 * `navigator` form, which is how visitors reach us on an origin-trial token
 * rather than a `chrome://flags` opt-in. Detecting only `document` registers
 * nothing for those visitors, and it fails silently: the page looks fine and
 * simply has no tools. Prefer `document`, fall back to `navigator`.
 */
function resolveModelContext(): WebMCPModelContext | undefined {
  const fromDocument =
    typeof document === "undefined" ? undefined : document.modelContext;
  if (typeof fromDocument?.registerTool === "function") return fromDocument;

  const fromNavigator =
    typeof navigator === "undefined" ? undefined : navigator.modelContext;
  if (typeof fromNavigator?.registerTool === "function") return fromNavigator;

  return undefined;
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
    const modelContext = resolveModelContext();
    if (!modelContext) return;

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
