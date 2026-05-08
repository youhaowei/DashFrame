"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

// ============================================================================
// Context
// ============================================================================

interface DatabaseContextValue {
  /** Whether the database is ready (database accessible) */
  isReady: boolean;
  /** Error if database initialization failed */
  error: Error | null;
}

const DatabaseContext = createContext<DatabaseContextValue>({
  isReady: false,
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
 *   const { isReady, error } = useDatabase();
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
 * Provider that initializes the Dexie database.
 *
 * This provider should wrap your application at a high level (typically in the root layout).
 * It initializes the database and signals when it's ready for use.
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
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    async function initDatabase() {
      try {
        // Initialize database by opening it (Dexie opens on first access)
        // This ensures the database is ready
        if (typeof window !== "undefined") {
          const { db } = await import("./db");
          // Open the database to ensure it's initialized
          await db.open();
        }

        if (mounted) {
          setIsReady(true);
          onReady?.();
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (mounted) {
          setError(error);
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
    <DatabaseContext.Provider value={{ isReady, error }}>
      {children}
    </DatabaseContext.Provider>
  );
}
