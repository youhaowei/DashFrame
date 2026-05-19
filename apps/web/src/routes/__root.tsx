import { createRootRoute, Link } from "@tanstack/react-router";
import { RouteRoot } from "../routeRoot";

function NotFound() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-neutral-fg-subtle">
        The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <Link to="/" className="text-sm underline">
        Go home
      </Link>
    </div>
  );
}

export const Route = createRootRoute({
  component: RouteRoot,
  notFoundComponent: NotFound,
});
