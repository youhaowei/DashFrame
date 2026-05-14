import { Link as RouterLink } from "@tanstack/react-router";
import { forwardRef, type AnchorHTMLAttributes } from "react";

import { parseNextHref } from "./url";

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
};

const Link = forwardRef<HTMLAnchorElement, LinkProps>(
  ({ href, children, ...props }, ref) => {
    const parsed = parseNextHref(href);

    if (parsed.isExternal) {
      return (
        <a ref={ref} href={href} {...props}>
          {children}
        </a>
      );
    }

    return (
      <RouterLink
        ref={ref}
        to={parsed.to}
        search={parsed.search as never}
        hash={parsed.hash as never}
        {...props}
      >
        {children}
      </RouterLink>
    );
  },
);

Link.displayName = "Link";

export default Link;
