import { createContext, useContext, type ReactNode } from "react";

const SignOutContext = createContext<(() => void) | undefined>(undefined);

/**
 * Hands the hosted session's sign-out action to the app shell. A host with no
 * accounts (desktop, local web) mounts no provider, so the shell offers none.
 */
export function SignOutProvider({
  onSignOut,
  children,
}: {
  onSignOut: () => void;
  children: ReactNode;
}) {
  return <SignOutContext value={onSignOut}>{children}</SignOutContext>;
}

export function useSignOut(): (() => void) | undefined {
  return useContext(SignOutContext);
}
