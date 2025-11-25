"use client";

import { ReactNode, useMemo } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";

/**
 * ConvexClientProvider
 *
 * Wraps the application with Convex context for real-time data sync.
 * Must be a client component because ConvexReactClient uses WebSocket.
 *
 * Features:
 * - Real-time subscriptions via WebSocket
 * - Automatic reconnection on network changes
 * - Convex Auth integration for user authentication
 */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  // Create a single ConvexReactClient instance for the entire app
  // useMemo ensures we don't recreate the client on re-renders
  const convex = useMemo(
    () => new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!),
    []
  );

  return (
    <ConvexAuthProvider client={convex}>
      {children}
    </ConvexAuthProvider>
  );
}
