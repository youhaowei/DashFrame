import { cn } from "@wystack/ui-react";
import { ExternalLinkIcon, GithubIcon } from "@wystack/ui-react/icons";
import { useConvexConnectionState } from "convex/react";

import { SettingsSection } from "./SettingsSection";

export const SOURCE_URL = "https://github.com/youhaowei/dashframe";

/**
 * Whether this app is connected to its host, and where its source lives. No
 * version is shown: no release process maintains one the app could read. The live
 * connection is the app's sync socket, which reaches Convex through the host,
 * so it stands for both.
 */
export function AboutSection() {
  const { isWebSocketConnected } = useConvexConnectionState();

  return (
    <SettingsSection
      id="about"
      title="About"
      description="The connection to the host, and where DashFrame's source lives."
    >
      <dl className="grid grid-cols-[max-content_1fr] gap-x-5 gap-y-2 text-sm">
        <dt className="text-neutral-fg-subtle">Host</dt>
        <dd className="flex items-center gap-2 text-neutral-fg">
          <span
            aria-hidden
            className={cn(
              "size-2 rounded-full transition-colors duration-200 motion-reduce:transition-none",
              isWebSocketConnected
                ? "bg-palette-success"
                : "bg-palette-warning",
            )}
          />
          {isWebSocketConnected ? "Connected" : "Reconnecting…"}
        </dd>
        <dt className="text-neutral-fg-subtle">Source</dt>
        <dd>
          <a
            href={SOURCE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-sm text-neutral-fg-subtle transition-colors duration-150 hover:text-neutral-fg focus-visible:ring-2 focus-visible:ring-neutral-ring focus-visible:outline-none motion-reduce:transition-none"
          >
            <GithubIcon aria-hidden className="size-4" />
            Open source on GitHub
            <ExternalLinkIcon aria-hidden className="size-3" />
          </a>
        </dd>
      </dl>
    </SettingsSection>
  );
}
