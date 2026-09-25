import { useSignOut } from "@/bootstrap/sign-out";
import { useAccessCapabilities } from "@/data";
import { getRuntimeConfig } from "@/data/runtime";
import { cn } from "@wystack/ui-react";
import { useState } from "react";

import { AboutSection } from "./_components/AboutSection";
import { AccountSection } from "./_components/AccountSection";
import { AppearanceSection } from "./_components/AppearanceSection";
import {
  CredentialsSection,
  isSecretKeyMissing,
} from "./_components/CredentialsSection";
import { PrivacySection } from "./_components/PrivacySection";
import { ProjectSection } from "./_components/ProjectSection";

/** The host this client talks to, and which kind of deployment it is. */
function readRuntime(): {
  hostUrl?: string;
  mode?: "local" | "hosted";
} {
  try {
    const { url, mode } = getRuntimeConfig();
    return { hostUrl: url, mode };
  } catch {
    return {};
  }
}

interface JumpTarget {
  id: string;
  title: string;
  needsAttention?: boolean;
}

/**
 * Settings for this installation and the open project: one scrolling page of
 * stacked sections, with jump chips under the title. A chip carries a dot only
 * when its section needs action.
 */
export default function SettingsPage() {
  const [{ hostUrl, mode }] = useState(readRuntime);
  const signOut = useSignOut();
  const capabilities = useAccessCapabilities().data;

  const sections: JumpTarget[] = [
    { id: "appearance", title: "Appearance" },
    { id: "project", title: "Project" },
    {
      id: "credentials",
      title: "Credentials",
      needsAttention: isSecretKeyMissing(capabilities),
    },
    { id: "privacy", title: "Privacy" },
    ...(signOut ? [{ id: "account", title: "Account" }] : []),
    { id: "about", title: "About" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-bg">
      <header className="shrink-0 px-4 pt-5 pb-2.5 sm:px-6">
        <h1 className="text-xl font-semibold text-neutral-fg">Settings</h1>
      </header>
      <nav
        aria-label="Jump to section"
        className="flex shrink-0 gap-1 overflow-x-auto px-4 pt-0.5 pb-2 [scrollbar-width:none] sm:flex-wrap sm:px-6"
      >
        {sections.map((section) => (
          <JumpChip key={section.id} target={section} />
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-1 pb-20 sm:px-6 sm:pb-8">
        <div className="max-w-[720px]">
          <AppearanceSection />
          <ProjectSection hostUrl={hostUrl} />
          <CredentialsSection />
          <PrivacySection mode={mode} />
          {signOut && <AccountSection onSignOut={signOut} />}
          <AboutSection />
        </div>
      </div>
    </div>
  );
}

function JumpChip({ target }: { target: JumpTarget }) {
  const jump = () => {
    const section = document.getElementById(`settings-${target.id}`);
    if (!section) return;
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    section.scrollIntoView?.({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
    // Move focus with the view, so the keyboard continues from the section.
    document
      .getElementById(`settings-${target.id}-title`)
      ?.focus({ preventScroll: true });
  };
  return (
    <button
      type="button"
      onClick={jump}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-neutral-bg-muted px-2.5 text-xs whitespace-nowrap text-neutral-fg-subtle transition-colors duration-150 hover:bg-neutral-bg-emphasis hover:text-neutral-fg focus-visible:ring-2 focus-visible:ring-neutral-ring focus-visible:outline-none motion-reduce:transition-none",
      )}
    >
      {target.needsAttention && (
        <span
          aria-hidden
          data-testid={`jump-attention-${target.id}`}
          className="size-1.5 rounded-full bg-palette-warning"
        />
      )}
      {target.title}
      {target.needsAttention && (
        <span className="sr-only"> (needs attention)</span>
      )}
    </button>
  );
}
