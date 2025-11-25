"use client";

import { useEffect, useState, useRef } from "react";
import { useAuthActions, useAuthToken } from "@convex-dev/auth/react";

/**
 * AnonymousAuthInitializer
 *
 * Automatically signs in users anonymously when the app loads.
 * Convex's Anonymous provider requires an explicit signIn() call,
 * even though no credentials are needed.
 *
 * Auth Flow:
 * 1. Component mounts → useAuthToken returns null
 * 2. Call signIn("anonymous")
 * 3. useAuthToken returns a token string
 * 4. Render children (app is ready for mutations)
 *
 * Edge Cases Handled:
 * - Network failures during sign-in (retry with exponential backoff)
 * - Race conditions (useRef to prevent double sign-in)
 * - localStorage unavailable (error state)
 * - Sign-in already in progress (skip redundant calls)
 */

interface Props {
  children: React.ReactNode;
}

export function AnonymousAuthInitializer({ children }: Props) {
  const { signIn } = useAuthActions();
  const token = useAuthToken();
  const [authError, setAuthError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const isSigningIn = useRef(false);
  const hasCheckedStorage = useRef(false);

  const isAuthenticated = token !== null;

  // Debug: Log token changes
  useEffect(() => {
    console.log("[AnonymousAuthInitializer] Auth token:", token ? "PRESENT" : "NULL");
    console.log("[AnonymousAuthInitializer] isAuthenticated:", isAuthenticated);
  }, [token, isAuthenticated]);

  // Wait a brief moment after authentication to ensure connection is stable
  useEffect(() => {
    if (isAuthenticated && !isReady) {
      console.log("[AnonymousAuthInitializer] Auth complete, waiting for connection to stabilize...");
      const timer = setTimeout(() => {
        console.log("[AnonymousAuthInitializer] Connection ready!");
        setIsReady(true);
      }, 500); // 500ms delay to let WebSocket reconnect
      return () => clearTimeout(timer);
    }
  }, [isAuthenticated, isReady]);

  // Check localStorage availability on mount
  useEffect(() => {
    if (hasCheckedStorage.current) return;
    hasCheckedStorage.current = true;

    try {
      const testKey = "__convex_auth_test__";
      localStorage.setItem(testKey, "test");
      localStorage.removeItem(testKey);
    } catch (error) {
      setAuthError(
        "Browser storage is disabled. Please enable cookies and local storage or exit private browsing mode."
      );
      setRetryCount(3); // Skip retries
    }
  }, []);

  // Perform anonymous sign-in
  useEffect(() => {
    // Skip if already authenticated or currently signing in
    if (isAuthenticated || isSigningIn.current) {
      return;
    }

    // Skip if localStorage check failed
    if (authError && retryCount >= 3) {
      return;
    }

    const performSignIn = async () => {
      isSigningIn.current = true;
      setAuthError(null);

      console.log("[AnonymousAuthInitializer] Starting anonymous sign-in...");

      try {
        // Call anonymous sign-in (pass empty object as params)
        const result = await signIn("anonymous", {});
        console.log("[AnonymousAuthInitializer] Sign-in result:", result);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        const isConnectionError = errorMessage.includes("Connection lost");

        // Only log non-connection errors (connection errors are expected during initial setup)
        if (!isConnectionError) {
          console.error("[AnonymousAuthInitializer] Authentication failed:", error);
        }

        setAuthError(
          error instanceof Error
            ? error.message
            : "Failed to establish anonymous session"
        );

        // Retry with exponential backoff (max 3 attempts)
        if (retryCount < 3) {
          const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
          if (!isConnectionError) {
            console.log(`[AnonymousAuthInitializer] Retrying in ${delay}ms (attempt ${retryCount + 1}/3)`);
          }
          setTimeout(() => {
            isSigningIn.current = false;
            setRetryCount((prev) => prev + 1);
          }, delay);
        }
      }
    };

    performSignIn();
  }, [signIn, isAuthenticated, retryCount, authError]);

  // Show error state if sign-in failed after retries
  if (authError && retryCount >= 3) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="space-y-4 text-center">
          <h2 className="text-destructive text-xl font-semibold">
            Authentication Error
          </h2>
          <p className="text-muted-foreground max-w-md">
            Unable to establish a session. Please check your internet connection
            and refresh the page.
          </p>
          <p className="text-muted-foreground text-sm">Error: {authError}</p>
        </div>
      </div>
    );
  }

  // Show loading state while authenticating or waiting for connection
  // Note: We render children immediately to avoid layout shift,
  // but show a subtle indicator that auth is in progress
  if (!isAuthenticated || !isReady) {
    return (
      <>
        {/* Subtle loading indicator in corner */}
        <div className="fixed right-4 top-4 z-50">
          <div className="bg-muted text-muted-foreground rounded-full px-3 py-2 text-xs">
            {!isAuthenticated ? "Initializing..." : "Connecting..."}
          </div>
        </div>
        {children}
      </>
    );
  }

  // Authenticated and ready - render normally
  return <>{children}</>;
}
