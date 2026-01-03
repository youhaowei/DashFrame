import { appRouter } from "@/lib/trpc/routers/_app";
import type { Context } from "@/lib/trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: (): Context => {
      // Convert Headers object to Record for rate limiter compatibility
      const headers: Record<string, string | string[] | undefined> = {};
      req.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return { headers };
    },
  });

export { handler as GET, handler as POST };
