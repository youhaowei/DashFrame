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
  },
});

/** Boot-time snapshot guarding the public permission identifiers. */
export const expectedPermissionIds = [
  "accessCredentials.manage",
  "commands.commit",
] as const;
