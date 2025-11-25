import { convexAuth } from "@convex-dev/auth/server";
import GitHub from "@auth/core/providers/github";
import Google from "@auth/core/providers/google";

/**
 * Convex Auth Setup
 *
 * Exports auth functions that are used in mutations/queries
 * to authenticate users and get their identity.
 */
export const { auth, signIn, signOut, store } = convexAuth({
  providers: [GitHub, Google],
});
