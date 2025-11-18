"use client";

import Link from "next/link";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";
import { ThemeToggle } from "@/components/theme-toggle";

const navItems = [
  { name: "Visualizations", href: "/" },
  { name: "Data Sources", href: "/data-sources" },
  { name: "Data Frames", href: "/data-frames" },
];

export function Navigation() {
  return (
    <header className="border-b border-border bg-background">
      <div className="flex items-center justify-between px-6 py-3">
        <div className="flex items-center">
          <h1 className="text-xl font-semibold text-foreground">DashFrame</h1>
          <NavigationMenu className="ml-10">
            <NavigationMenuList>
              {navItems.map((item) => (
                <NavigationMenuItem key={item.href}>
                  <NavigationMenuLink asChild>
                    <Link href={item.href} className={navigationMenuTriggerStyle()}>
                      {item.name}
                    </Link>
                  </NavigationMenuLink>
                </NavigationMenuItem>
              ))}
            </NavigationMenuList>
          </NavigationMenu>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}
