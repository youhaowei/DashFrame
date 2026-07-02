import type { Command } from "@wystack/server";

export interface LateBoundOperandRef {
  commandIndex: number;
  path: string;
  jsonPath: string;
  kind: string;
  label?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectLateBound(
  value: unknown,
  path: string,
  out: Array<Omit<LateBoundOperandRef, "commandIndex" | "path">>,
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectLateBound(item, `${path}[${index}]`, out),
    );
    return;
  }
  if (!isRecord(value)) return;

  if (value.kind === "lateBound") {
    out.push({
      jsonPath: path,
      kind: "lateBound",
      label: typeof value.label === "string" ? value.label : undefined,
    });
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    collectLateBound(child, path ? `${path}.${key}` : key, out);
  }
}

export function findLateBound(commands: Command[]): LateBoundOperandRef[] {
  return commands.flatMap((command, commandIndex) => {
    const found: Array<Omit<LateBoundOperandRef, "commandIndex" | "path">> = [];
    collectLateBound(command.args, "args", found);
    return found.map((entry) => ({
      commandIndex,
      path: command.path,
      ...entry,
    }));
  });
}

export function assertPublishLogHasNoLateBound(log: Command[]): void {
  if (findLateBound(log).length > 0) {
    throw new Error("publishDraft: draft contains unbound late-bound operands");
  }
}
