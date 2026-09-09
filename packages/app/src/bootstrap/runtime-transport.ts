import type { AppRuntimeConfig } from "../data/runtime";
import { z } from "zod";

import type { HostAccessResult } from "./host-bootstrap-controller";

const nonBlank = z
  .string()
  .min(1)
  .refine((value) => value.trim() === value);
const runtimeConfig = z.object({ convexUrl: nonBlank }).strict();
const replySchema = z.union([
  z
    .object({
      mode: z.literal("local"),
      status: z.literal("local-ready"),
      config: runtimeConfig,
    })
    .strict(),
  z
    .object({
      mode: z.literal("hosted"),
      status: z.enum(["signed-out", "pending", "revoked", "unavailable"]),
    })
    .strict(),
  z
    .object({
      mode: z.literal("hosted"),
      status: z.literal("admitted"),
      subject: nonBlank,
      workspaceId: nonBlank,
      config: runtimeConfig,
    })
    .strict(),
]);

export type RuntimeReply = z.infer<typeof replySchema>;
export type HostRuntimeConfig = AppRuntimeConfig &
  (
    | { mode: "local" }
    | { mode: "hosted"; subject: string; workspaceId: string }
  );

export function sameHostRuntime(
  a: HostRuntimeConfig,
  b: HostRuntimeConfig,
): boolean {
  return (
    a.mode === b.mode &&
    a.url === b.url &&
    a.convexUrl === b.convexUrl &&
    a.token === b.token &&
    (a.mode === "local" ||
      (b.mode === "hosted" &&
        a.subject === b.subject &&
        a.workspaceId === b.workspaceId))
  );
}

/**
 * Only a validated response from the configured host can select local mode.
 *
 * `token` is the client's own credential for this host — the desktop shell's
 * per-launch loopback token today. It rides alongside the cookie rather than
 * replacing it: a browser client sends neither header nor token and keeps the
 * same-origin session it already had.
 */
export async function lookupHostRuntime(
  hostUrl: string,
  signal: AbortSignal,
  options?: { token?: string },
): Promise<HostAccessResult<HostRuntimeConfig>> {
  try {
    const response = await fetch(new URL("/api/runtime", hostUrl), {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal,
      headers: {
        Accept: "application/json",
        ...(options?.token
          ? { Authorization: `Bearer ${options.token}` }
          : undefined),
      },
    });
    if (
      response.redirected ||
      response.headers.get("content-type")?.split(";")[0]?.trim() !==
        "application/json"
    ) {
      return { status: "unavailable" };
    }
    const parsed = replySchema.safeParse(await response.json());
    if (!parsed.success) return { status: "unavailable" };
    const reply = parsed.data;
    let expectedStatus = 200;
    if (reply.status === "signed-out") expectedStatus = 401;
    if (reply.status === "unavailable") expectedStatus = 503;
    if (response.status !== expectedStatus) return { status: "unavailable" };
    if (reply.status === "signed-out" || reply.status === "unavailable")
      return { status: reply.status };
    if (reply.status === "pending" || reply.status === "revoked")
      return { status: "pending-admission" };
    if (reply.status !== "local-ready" && reply.status !== "admitted")
      return { status: "unavailable" };
    const convex = new URL(reply.config.convexUrl);
    const expected = new URL("/api/convex", hostUrl);
    if (convex.href !== expected.href) return { status: "unavailable" };
    const config = {
      url: new URL(hostUrl).origin,
      convexUrl: convex.href,
      ...(options?.token ? { token: options.token } : undefined),
    };
    return reply.mode === "local"
      ? { status: "local-ready", config: { ...config, mode: "local" } }
      : {
          status: "admitted",
          config: {
            ...config,
            mode: "hosted",
            subject: reply.subject,
            workspaceId: reply.workspaceId,
          },
        };
  } catch (error) {
    if (signal.aborted) throw error;
    return { status: "unavailable" };
  }
}
