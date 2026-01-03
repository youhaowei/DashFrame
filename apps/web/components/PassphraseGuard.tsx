"use client";

import { PassphraseModal } from "@/components/PassphraseModal";
import { useEncryption } from "@/lib/contexts/encryption-context";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface PassphraseGuardProps {
  children: React.ReactNode;
}

/**
 * PassphraseGuard component
 *
 * Guards protected routes by showing PassphraseModal when encryption is locked.
 * Protected routes that require encryption to be unlocked:
 * - /data-sources (contains sensitive API keys)
 *
 * Non-protected routes (accessible without unlocking):
 * - / (home/dashboards)
 * - /visualizations
 * - /insights
 *
 * @example
 * ```tsx
 * <PassphraseGuard>
 *   {children}
 * </PassphraseGuard>
 * ```
 */
export function PassphraseGuard({ children }: PassphraseGuardProps) {
  const { isUnlocked, isInitialized } = useEncryption();
  const pathname = usePathname();
  const [showModal, setShowModal] = useState(false);

  // Protected routes that require encryption to be unlocked
  const protectedRoutes = ["/data-sources"];

  // Check if current route is protected
  const isProtectedRoute = protectedRoutes.some((route) =>
    pathname.startsWith(route),
  );

  useEffect(() => {
    // Show modal if:
    // 1. User is on a protected route AND encryption is not unlocked
    // This covers both cases:
    //    - First time setup (not initialized)
    //    - Subsequent sessions (initialized but locked)
    if (isProtectedRoute && !isUnlocked) {
      setShowModal(true);
    } else {
      setShowModal(false);
    }
  }, [isProtectedRoute, isUnlocked, isInitialized]);

  return (
    <>
      {children}
      <PassphraseModal isOpen={showModal} onClose={() => setShowModal(false)} />
    </>
  );
}
