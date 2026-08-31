import { COMMAND_PATHS, type Command } from "@dashframe/types";
import { z } from "zod";
import { CREDENTIAL_CLASS } from "@dashframe/server-core";
import type { HostContext } from "./context";

const known = new Set<string>(Object.values(COMMAND_PATHS));
export function assertKnownCommandPaths(
  commands: readonly Command[],
  surface: string,
): void {
  for (const command of commands) {
    if (!known.has(command.path))
      throw new Error(`${surface}: unsupported command ${command.path}`);
  }
}

export function draftIdFromBatchError(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("draftId" in error)) return undefined;
  return typeof error.draftId === "string" ? error.draftId : undefined;
}

const commandsInput = z
  .array(
    z
      .object({
        id: z.string().optional(),
        path: z.string(),
        args: z.record(z.string(), z.unknown()),
      })
      .strict(),
  )
  .max(200);

/** Resolve plaintext on the host before any command reaches Convex or a log. */
export async function stageCommandCredentials(
  ctx: HostContext,
  input: unknown,
) {
  const commands = commandsInput.parse(input);
  assertKnownCommandPaths(commands, "batch");
  const staged = [];
  for (const command of commands) {
    const args = { ...command.args };
    if (
      command.path === COMMAND_PATHS.CreateDataSource ||
      command.path === COMMAND_PATHS.SetDataSourceConfig
    ) {
      await stageFields(ctx, args);
    }
    staged.push({ ...command, args });
  }
  return staged;
}

async function stageFields(ctx: HostContext, args: Record<string, unknown>) {
  for (const field of ["apiKey", "connectionString"] as const) {
    const plaintext = args[field];
    if (plaintext === undefined || plaintext === "") continue;
    if (typeof plaintext !== "string")
      throw new Error("Invalid credential field");
    if (!ctx.vault) throw new Error("SecretVault is required for credentials");
    // Ref-shaped caller input is still plaintext, never an adopted capability.
    args[field] = await ctx.vault.store(plaintext, {
      class: CREDENTIAL_CLASS.ConnectorKey,
      locatorHint: `${field}-${String(args.id ?? "new")}`,
    });
  }
}
