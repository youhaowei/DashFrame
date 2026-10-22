import {
  cancelPoll,
  newPollToken,
  oauthSetupErrorMessage,
  runOAuthSetup,
} from "@/lib/connector-oauth-setup";
import type { UUID } from "@dashframe/types";
import { Button, FieldError } from "@wystack/ui-react";
import { useEffect, useRef, useState } from "react";

type SignInState =
  | { status: "idle" }
  | { status: "waiting"; signInUrl?: string }
  | { status: "failed"; message: string };

export interface Ga4SignInAgainProps {
  sourceId: UUID;
  /** Called once the source holds a working Google sign-in again. */
  onSignedIn: () => void;
}

/**
 * Shown when a Google Analytics source's stored sign-in no longer works.
 * Renews the sign-in of this same source, so its tables, metrics, and the
 * reports built on them carry on as before.
 */
export function Ga4SignInAgain({ sourceId, onSignedIn }: Ga4SignInAgainProps) {
  const [state, setState] = useState<SignInState>({ status: "idle" });
  const token = useRef(newPollToken());
  useEffect(() => {
    const current = token.current;
    return () => cancelPoll(current);
  }, []);

  const signIn = async () => {
    const current = token.current;
    current.cancelled = false;
    setState({ status: "waiting" });
    try {
      await runOAuthSetup(
        {
          connectorId: "googleAnalytics",
          requestedName: "Google Analytics",
          reconnectDataSourceId: sourceId,
        },
        async () => onSignedIn(),
        current,
        (signInUrl) => setState({ status: "waiting", signInUrl }),
      );
    } catch (error) {
      if (current.cancelled) return;
      setState({
        status: "failed",
        message:
          oauthSetupErrorMessage(error) ??
          "Google sign-in didn't finish. Try again.",
      });
    }
  };

  const waiting = state.status === "waiting";
  return (
    <div role="alert" className="space-y-3">
      <div>
        <p className="text-sm font-medium text-neutral-fg">
          Google sign-in expired.
        </p>
        <p className="mt-1 text-sm text-neutral-fg-subtle">
          Sign in again with the Google account that connected this source. Its
          tables and reports stay as they are.
        </p>
      </div>
      <Button
        variant="outline"
        label={waiting ? "Waiting for Google..." : "Sign in with Google"}
        disabled={waiting}
        onClick={() => void signIn()}
      />
      {state.status === "waiting" && state.signInUrl && (
        <p className="text-xs text-neutral-fg-subtle">
          Don't see the Google sign-in page?{" "}
          <a
            href={state.signInUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-neutral-fg underline underline-offset-2"
          >
            Open Google sign-in
          </a>
        </p>
      )}
      {state.status === "failed" && (
        <FieldError errors={[{ message: state.message }]} />
      )}
    </div>
  );
}
