"use client";

import { PassphraseModal } from "@/components/PassphraseModal";
import { useEncryption } from "@/lib/contexts/encryption-context";
import { usePathname } from "next/navigation";

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
  const { isUnlocked } = useEncryption();
  const pathname = usePathname();

  // Protected routes that require encryption to be unlocked
  const protectedRoutes = ["/data-sources"];

  // Check if current route is protected
  const isProtectedRoute = protectedRoutes.some((route) =>
    pathname.startsWith(route),
  );

  // Show modal if user is on a protected route AND encryption is not unlocked
  // This covers both cases:
  //    - First time setup (not initialized)
  //    - Subsequent sessions (initialized but locked)
  // Derived state - no need for useState/useEffect
  const showModal = isProtectedRoute && !isUnlocked;

  return (
    <>
      {children}
      <PassphraseModal isOpen={showModal} />
    </>
  );
}
