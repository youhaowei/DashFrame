import { useLocation, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

import { parseNextHref } from "./url";

type NavigateOptions = {
  replace?: boolean;
};

export function useRouter() {
  const navigate = useNavigate();
  const navigateHref = (href: string, options?: NavigateOptions) => {
    const parsed = parseNextHref(href);

    if (parsed.isExternal) {
      if (options?.replace) {
        window.location.replace(href);
      } else {
        window.location.assign(href);
      }
      return;
    }

    return navigate({
      to: parsed.to,
      search: parsed.search as never,
      hash: parsed.hash as never,
      replace: options?.replace,
    } as never);
  };

  return {
    push: (href: string, options?: NavigateOptions) =>
      navigateHref(href, options),
    replace: (href: string) => navigateHref(href, { replace: true }),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    // Next.js refresh revalidates server-rendered data; DashFrame's Vite app has no equivalent cache to invalidate here.
    refresh: () => {},
  };
}

export function usePathname() {
  return useLocation({ select: (location) => location.pathname });
}

export function useSearchParams() {
  const searchStr = useLocation({ select: (location) => location.searchStr });
  return useMemo(() => new URLSearchParams(searchStr), [searchStr]);
}
