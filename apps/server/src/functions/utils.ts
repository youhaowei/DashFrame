/**
 * Helpers shared between the legacy coarse handlers (`app-artifacts.ts`) and
 * the command vocabulary (`commands.ts`) while both write paths coexist
 * (transition window, YW-157).
 */

export type DataSourceConfig = {
  apiKey?: string;
  connectionString?: string;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireRecordWithId(
  value: unknown,
  label: string,
): { id: string } {
  if (!isRecord(value) || typeof value.id !== "string") {
    throw new Error(`${label} must be an object with an id`);
  }
  return value as { id: string };
}
