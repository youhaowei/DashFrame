import { createHash, randomUUID } from "node:crypto";
import { COMMAND_PATHS, type Command } from "@dashframe/types";
import { z } from "zod";
import { CREDENTIAL_CLASS } from "@dashframe/server-core";
import type { SecretRef } from "@wystack/secret-vault";
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

export class HostBatchRejectedError extends Error {
  constructor(cause?: unknown) {
    super(
      cause instanceof Error
        ? cause.message
        : "Host command batch was cancelled",
      { cause },
    );
    this.name = "HostBatchRejectedError";
  }
}
export class HostBatchOutcomeUnknownError extends Error {
  readonly code = "HOST_BATCH_OUTCOME_UNKNOWN";
  constructor(readonly operationId: string) {
    super(
      "Host command outcome is unconfirmed; retry with the same operation ID",
    );
    this.name = "HostBatchOutcomeUnknownError";
  }
}

const commandsInput = z
  .array(
    z
      .object({
        id: z.string().optional(),
        path: z.string(),
        args: z.record(z.string(), z.json()),
      })
      .strict(),
  )
  .max(200);

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Record every minted ref before the next vault write can fail. */
async function stageCommandCredentials(
  ctx: HostContext,
  commands: z.infer<typeof commandsInput>,
  refs: SecretRef[],
) {
  const staged = [];
  for (const command of commands) {
    const args = { ...command.args };
    if (
      command.path === COMMAND_PATHS.CreateDataSource ||
      command.path === COMMAND_PATHS.SetDataSourceConfig
    ) {
      await stageFields(ctx, args, refs);
    }
    staged.push({ ...command, args });
  }
  return staged;
}

async function stageFields(
  ctx: HostContext,
  args: z.infer<typeof commandsInput>[number]["args"],
  refs: SecretRef[],
) {
  for (const field of ["apiKey", "connectionString"] as const) {
    const plaintext = args[field];
    if (plaintext === undefined || plaintext === "") continue;
    if (typeof plaintext !== "string")
      throw new Error("Invalid credential field");
    if (!ctx.vault) throw new Error("SecretVault is required for credentials");
    const ref = await ctx.vault.store(plaintext, {
      class: CREDENTIAL_CLASS.ConnectorKey,
      locatorHint: `${field}-${String(args.id ?? "new")}`,
    });
    refs.push(ref);
    args[field] = ref;
  }
}

async function flushCleanup(ctx: HostContext) {
  try {
    await ctx.cleanupResources?.();
  } catch {
    console.warn(
      "[dashframe] Resource cleanup deferred; durable records retained",
    );
  }
}

/** Fence uncertain HTTP outcomes before releasing any staged credentials. */
export async function executeHostCommandBatch(
  ctx: HostContext,
  input: { commands: unknown; operationId?: string; draftId?: string },
  mode: "commit" | "draft",
) {
  const commands = commandsInput.parse(
    JSON.parse(JSON.stringify(input.commands)),
  );
  assertKnownCommandPaths(commands, "batch");
  const identity = {
    operationId: input.operationId ?? randomUUID(),
    principal: ctx.principal,
    requestHash: createHash("sha256")
      .update(stable({ commands, mode, draftId: input.draftId }))
      .digest("hex"),
  };
  let prior;
  try {
    prior = await ctx.metadata.getHostBatch(identity);
  } catch {
    throw new HostBatchOutcomeUnknownError(identity.operationId);
  }
  if (prior?.status === "cancelled") throw new HostBatchRejectedError();
  if (prior?.status === "completed") {
    await flushCleanup(ctx);
    return prior.result;
  }
  const stagedRefs: SecretRef[] = [];
  let prepareAttempted = prior !== null;
  try {
    if (!prior) {
      const staged = await stageCommandCredentials(ctx, commands, stagedRefs);
      prepareAttempted = true;
      prior = await ctx.metadata.prepareHostBatch({
        ...identity,
        commands: staged,
        mode,
        stagedRefs,
        ...(input.draftId ? { draftId: input.draftId } : {}),
      });
    }
    if (prior.status === "cancelled") throw new HostBatchRejectedError();
    const completed =
      prior.status === "completed"
        ? prior
        : await ctx.metadata.executeHostBatch(identity);
    if (completed.status !== "completed") throw new HostBatchRejectedError();
    await flushCleanup(ctx);
    return completed.result;
  } catch (error) {
    return settleFailure(ctx, identity, stagedRefs, prepareAttempted, error);
  }
}

async function settleFailure(
  ctx: HostContext,
  identity: Parameters<HostContext["metadata"]["getHostBatch"]>[0],
  stagedRefs: SecretRef[],
  prepareAttempted: boolean,
  error: unknown,
) {
  let terminal;
  try {
    terminal = await ctx.metadata.settleHostBatch({
      ...identity,
      stagedRefs,
    });
  } catch {
    // Before prepare, these fresh refs cannot be referenced by any mutation.
    // After prepare was attempted, only the durable cancellation fence is safe.
    if (!prepareAttempted) {
      await Promise.allSettled(stagedRefs.map((ref) => ctx.vault!.delete(ref)));
    }
    throw new HostBatchOutcomeUnknownError(identity.operationId);
  }
  await flushCleanup(ctx);
  if (terminal.status === "completed") return terminal.result;
  throw new HostBatchRejectedError(error);
}
