import { useLocation, useNavigate } from "@tanstack/react-router";

type NavigateOptions = {
  replace?: boolean;
};

function toPath(href: string) {
  return href;
}

export function useRouter() {
  const navigate = useNavigate();

  return {
    push: (href: string, options?: NavigateOptions) =>
      navigate({ to: toPath(href), replace: options?.replace } as never),
    replace: (href: string) =>
      navigate({ to: toPath(href), replace: true } as never),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    refresh: () => {},
  };
}

export function usePathname() {
  return useLocation({ select: (location) => location.pathname });
}

export function useSearchParams() {
  return useLocation({
    select: (location) => new URLSearchParams(location.searchStr),
  });
}
