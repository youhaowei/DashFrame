import type { ReactNode } from "react";

import { PostHogPageView } from "../components/providers/PostHogPageView";
import { PostHogProvider } from "../components/providers/PostHogProvider";

/**
 * Web-only provider wrapper injected into the shared renderer via router
 * context. Mounts PostHog analytics around the portable provider tree.
 * PostHogPageView uses router hooks, so it must render inside RouterProvider —
 * which it does, because the shared RouteRoot (and thus this wrapper) renders
 * under RouterProvider.
 *
 * Uses relative imports (not `@/`) because the web host's `@` alias now points
 * at packages/app (the shared renderer), so web-only files reach their siblings
 * by relative path.
 */
export function WebProviders({ children }: { children: ReactNode }) {
  return (
    <PostHogProvider>
      <PostHogPageView />
      {children}
    </PostHogProvider>
  );
}
