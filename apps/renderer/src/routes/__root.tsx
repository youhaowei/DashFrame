import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";

import type { RouterContext } from "../main";

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => <Outlet />,
});
