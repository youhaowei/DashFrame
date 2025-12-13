"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { migrateFromLocalStorage, isMigrationComplete } from "./migration";

// ============================================================================
// Context
// ============================================================================

interface DatabaseContextValue {
  /** Whether the database is ready (migration complete, database accessible) */
  isReady: boolean;
  /** Whether migration is currently in progress */
  isMigrating: boolean;
  /** Error if database initialization failed */
  error: Error | null;
}

const DatabaseContext = createContext<DatabaseContextValue>({
  isReady: false,
  isMigrating: false,
  error: null,
});

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook to access database ready state.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { isReady, isMigrating, error } = useDatabase();
 *
 *   if (error) return <div>Database error: {error.message}</div>;
 *   if (!isReady) return <div>Loading...</div>;
 *
 *   return <div>Database ready!</div>;
 * }
 * ```
 */
export function useDatabase(): DatabaseContextValue {
  return useContext(DatabaseContext);
}

// ============================================================================
// Provider
// ============================================================================

interface DatabaseProviderProps {
  children: ReactNode;
  /**
   * Optional callback when migration completes.
   * Useful for triggering other initialization logic.
   */
  onReady?: () => void;
  /**
   * Optional callback when migration fails.
   */
  onError?: (error: Error) => void;
}

/**
 * Provider that initializes the Dexie database and handles migration from localStorage.
 *
 * This provider should wrap your application at a high level (typically in the root layout).
 * It automatically:
 * 1. Checks if migration from localStorage is needed
 * 2. Performs migration if necessary (one-time operation)
 * 3. Signals when the database is ready for use
 *
 * @example
 * ```tsx
 * // app/layout.tsx
 * import { DatabaseProvider } from '@dashframe/core-dexie';
 *
 * export default function RootLayout({ children }) {
 *   return (
 *     <html>
 *       <body>
 *         <DatabaseProvider>
 *           {children}
 *         </DatabaseProvider>
 *       </body>
 *     </html>
 *   );
 * }
 * ```
 */
export function DatabaseProvider({
  children,
  onReady,
  onError,
}: DatabaseProviderProps): ReactNode {
  const [isReady, setIsReady] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    async function initDatabase() {
      // If already migrated, we're ready immediately
      if (isMigrationComplete()) {
        if (mounted) {
          setIsReady(true);
          onReady?.();
        }
        return;
      }

      // Perform migration
      setIsMigrating(true);

      try {
        await migrateFromLocalStorage();
        if (mounted) {
          setIsReady(true);
          setIsMigrating(false);
          onReady?.();
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (mounted) {
          setError(error);
          setIsMigrating(false);
          onError?.(error);
        }
      }
    }

    initDatabase();

    return () => {
      mounted = false;
    };
  }, [onReady, onError]);

  return (
    <DatabaseContext.Provider value={{ isReady, isMigrating, error }}>
      {children}
    </DatabaseContext.Provider>
  );
}
