import { Button } from "@wystack/ui-react";

export interface GoogleSignInButtonProps {
  onClick: () => void;
  /** True while the sign-in runs in Google's page. */
  waiting: boolean;
  disabled?: boolean;
  /** The sign-in page, offered as a link when the browser opened no window for it. */
  signInUrl?: string;
  "aria-describedby"?: string;
  className?: string;
}

/**
 * The one Google sign-in action: connecting a new source and renewing an
 * expired one look and behave the same.
 */
export function GoogleSignInButton({
  onClick,
  waiting,
  disabled,
  signInUrl,
  "aria-describedby": describedBy,
  className,
}: GoogleSignInButtonProps) {
  return (
    <>
      <Button
        label={waiting ? "Waiting for Google..." : "Sign in with Google"}
        onClick={onClick}
        disabled={waiting || disabled}
        aria-describedby={describedBy}
        className={className}
      />
      {waiting && signInUrl && (
        <p className="text-xs text-neutral-fg-subtle">
          Don't see the Google sign-in page?{" "}
          <a
            href={signInUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-neutral-fg underline underline-offset-2"
          >
            Open Google sign-in
          </a>
        </p>
      )}
    </>
  );
}
