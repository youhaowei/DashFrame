import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
// Uncomment when OAuth is needed:
// import GitHub from "@auth/core/providers/github";
// import Google from "@auth/core/providers/google";

/**
 * Convex Auth Setup
 *
 * Exports auth functions that are used in mutations/queries
 * to authenticate users and get their identity.
 *
 * Currently using Anonymous provider for persistent storage without requiring login.
 * Anonymous users get a unique identity that persists across sessions via localStorage.
 *
 * To enable OAuth:
 * 1. Uncomment GitHub/Google imports above
 * 2. Add them to providers array: [Anonymous, GitHub, Google]
 * 3. Set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *    in Convex dashboard environment variables
 */
export const { auth, signIn, signOut, store } = convexAuth({
  providers: [Anonymous],
});
