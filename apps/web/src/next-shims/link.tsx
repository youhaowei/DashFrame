import { Link as RouterLink } from "@tanstack/react-router";
import { forwardRef, type AnchorHTMLAttributes } from "react";

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
};

const Link = forwardRef<HTMLAnchorElement, LinkProps>(
  ({ href, children, ...props }, ref) => (
    <RouterLink ref={ref} to={href} {...props}>
      {children}
    </RouterLink>
  ),
);

Link.displayName = "Link";

export default Link;
