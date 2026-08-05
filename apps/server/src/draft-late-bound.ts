import type { Command } from "@wystack/server";

/** Discriminant of a late-bound operand's `ref.type` (PIN 4.8a / 4.8b). */
export type LateBoundRefType =
  | "column"
  | "category"
  | "placeholder"
  | "unknown";

export interface LateBoundOperandRef {
  commandIndex: number;
  path: string;
  jsonPath: string;
  kind: string;
  label?: string;
  /**
   * Re-derived from the log node's `ref.type`. Missing or unrecognized types
   * map to `"unknown"` and are remove-only (never bindable).
   */
  refType: LateBoundRefType;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read `ref.type` off a late-bound node. Never trusts client-supplied values —
 * the server re-derives this from the durable log for every bind check.
 */
export function refTypeFromLateBoundNode(value: unknown): LateBoundRefType {
  if (!isRecord(value) || value.kind !== "lateBound") return "unknown";
  const ref = value.ref;
  if (!isRecord(ref) || typeof ref.type !== "string") return "unknown";
  if (
    ref.type === "column" ||
    ref.type === "category" ||
    ref.type === "placeholder"
  ) {
    return ref.type;
  }
  return "unknown";
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
    const ref = isRecord(value.ref) ? value.ref : undefined;
    const refType = refTypeFromLateBoundNode(value);
    let label: string | undefined;
    if (typeof value.label === "string") label = value.label;
    else if (typeof ref?.prompt === "string") label = ref.prompt;
    out.push({
      jsonPath: path,
      kind: "lateBound",
      label,
      refType,
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
