import { isPrincipal } from "@wystack/identity";
import { definePermissions } from "@wystack/permissions";

import type { AppContext } from "./app-context";

export const LOCAL_USER_ID = "local-user";

/**
 * The synthesized principal for the token-less loopback config (see
 * `createDashframeServer` in app.ts) — deliberately NOT `LOCAL_USER_ID`.
 *
 * `commands.commit` only requires `principal.kind === "user"`, so this
 * identity is enough to keep that loopback config writable. But
 * `accessCredentials.manage` additionally requires
 * `principal.userId === LOCAL_USER_ID` specifically — that's the operator's
 * own identity, meant to gate minting durable, off-host-usable API
 * credentials behind an authenticated bind. If the loopback synthesis used
 * `LOCAL_USER_ID` too, every unauthenticated request on a token-less server
 * would silently double as the operator for that check, and could mint a
 * credential usable from anywhere. `loopback-anonymous` is a real,
 * well-formed `user` principal (satisfies `commands.commit`) but is never
 * equal to `LOCAL_USER_ID` (still denied by `accessCredentials.manage`).
 */
export const LOOPBACK_ANON_USER_ID = "loopback-anonymous";

export const permissions = definePermissions<AppContext>()({
  accessCredentials: {
    manage: {
      description: "Manage API access credentials",
      check: (ctx) =>
        isPrincipal(ctx.principal) &&
        ctx.principal.kind === "user" &&
        ctx.principal.userId === LOCAL_USER_ID,
    },
  },
  commands: {
    commit: {
      description:
        "Commit or replay commands against canonical state (preview and draft-append stay open to any principal)",
      check: (ctx) =>
        ctx.mode === "preview" ||
        ctx.draftId != null ||
        ctx.__publishReplay === true ||
        (isPrincipal(ctx.principal) && ctx.principal.kind === "user"),
    },
    preview: {
      description:
        "Preview a command batch (execute-then-rollback; canonical state is never touched). " +
        "Open to any WELL-FORMED principal, service or user — declared explicitly so " +
        "`previewDiff` carries the same `.authorize(...)` shape as every other " +
        "command-dispatching procedure, rather than relying on the absence of a check to " +
        "mean 'open'. This does not waive the identity requirement: `evaluate()` denies " +
        "before it ever calls `check` when there is no well-formed `Principal` at all " +
        "(see @wystack/permissions), so a request still needs SOME resolved principal — " +
        "which is what makes the no-auth-configured loopback fix in app.ts load-bearing.",
      check: () => true,
    },
  },
  connectors: {
    setup: {
      description: "Set up connector credentials",
      check: (ctx) =>
        isPrincipal(ctx.principal) &&
        (ctx.principal.kind === "user" || ctx.principal.kind === "service"),
    },
  },
});

/** Boot-time snapshot guarding the public permission identifiers. */
export const expectedPermissionIds = [
  "accessCredentials.manage",
  "commands.commit",
  "commands.preview",
  "connectors.setup",
] as const;
