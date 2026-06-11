/**
 * tRPC stub for the shared renderer.
 *
 * The web app's real tRPC client (the Notion connector proxy) is NOT part of
 * the shared package — it stays host-specific in apps/web and is slated for
 * removal entirely once Notion is rewired onto the WyStack/server path.
 *
 * The Notion path is dead in v0.2 (gated behind `showNotion` / `NOTION_ENABLED`,
 * both default-false), so nothing here is ever invoked at runtime. This stub
 * exists only so the static `@/lib/trpc/Provider` imports in the moved
 * data-source components and routeRoot resolve. Any actual call throws.
 *
 * When Notion is rewired onto the WyStack/server path, delete this.
 */
import type { ReactNode } from "react";

function notWired(): never {
  throw new Error(
    "Notion tRPC connector is not wired in v0.2. " +
      "The Notion data-source path is disabled behind showNotion/NOTION_ENABLED.",
  );
}

// A proxy that yields the same `.notion.<fn>.useMutation()` access shape the
// call-sites use, but throws if a mutation is actually executed. Reads return
// a stable inert hook object so component render doesn't crash.
const inertMutation = {
  mutate: notWired,
  mutateAsync: notWired,
  isPending: false,
  isError: false,
  isSuccess: false,
  error: null,
  data: undefined,
  reset: () => {},
};

function makeProxy(): unknown {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "useMutation" || prop === "useQuery") {
          return () => inertMutation;
        }
        return makeProxy();
      },
    },
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- stub proxy mirrors the generated tRPC client surface
export const trpc = makeProxy() as any;

/** Pass-through — the real provider (React Query + tRPC) is web-only. */
export function TRPCProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
