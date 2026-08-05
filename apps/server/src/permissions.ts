import { isPrincipal } from "@wystack/identity";
import { definePermissions } from "@wystack/permissions";

import type { AppContext } from "./app-context";

export const LOCAL_USER_ID = "local-user";

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
});

/** Boot-time snapshot guarding the public permission identifiers. */
export const expectedPermissionIds = [
  "accessCredentials.manage",
  "commands.commit",
  "commands.preview",
] as const;
