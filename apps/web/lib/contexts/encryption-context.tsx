"use client";

import {
  initializeEncryption,
  isEncryptionInitialized,
  isEncryptionUnlocked,
  lockEncryption,
  unlockEncryption,
} from "@dashframe/core-dexie/crypto/key-manager";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

/**
 * Encryption context state and functions
 */
interface EncryptionContextValue {
  /**
   * Whether encryption has been initialized (passphrase set up)
   */
  isInitialized: boolean;
  /**
   * Whether encryption is currently unlocked (key available in memory)
   */
  isUnlocked: boolean;
  /**
   * Initialize encryption with a new passphrase.
   * Only call this on first-time setup.
   */
  initialize: (passphrase: string) => Promise<void>;
  /**
   * Unlock encryption with the user's passphrase.
   * Call this to decrypt data after page reload or lock.
   */
  unlock: (passphrase: string) => Promise<void>;
  /**
   * Lock encryption by clearing the key from memory.
   * User will need to unlock again to access encrypted data.
   */
  lock: () => void;
  /**
   * Error message from last operation, if any
   */
  error: string | null;
  /**
   * Whether an async operation is in progress
   */
  isLoading: boolean;
}

const EncryptionContext = createContext<EncryptionContextValue>({
  isInitialized: false,
  isUnlocked: false,
  initialize: async () => {},
  unlock: async () => {},
  lock: () => {},
  error: null,
  isLoading: false,
});

/**
 * EncryptionProvider component
 *
 * Wraps the app to provide encryption state and functions.
 * Checks initialization status on mount.
 *
 * @example
 * <EncryptionProvider>
 *   <App />
 * </EncryptionProvider>
 */
export function EncryptionProvider({ children }: { children: React.ReactNode }) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Check initialization status on mount
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const initialized = await isEncryptionInitialized();
        if (cancelled) return;

        setIsInitialized(initialized);
        setIsUnlocked(isEncryptionUnlocked());
      } catch (err) {
        if (cancelled) return;

        console.error("Failed to check encryption status:", err);
        setError(
          err instanceof Error
            ? err.message
            : "Failed to check encryption status",
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Initialize encryption with a new passphrase
   */
  const initialize = useCallback(async (passphrase: string) => {
    setIsLoading(true);
    setError(null);

    try {
      await initializeEncryption(passphrase);
      setIsInitialized(true);
      setIsUnlocked(true);
    } catch (err) {
      console.error("Failed to initialize encryption:", err);
      setError(
        err instanceof Error ? err.message : "Failed to initialize encryption",
      );
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Unlock encryption with passphrase
   */
  const unlock = useCallback(async (passphrase: string) => {
    setIsLoading(true);
    setError(null);

    try {
      await unlockEncryption(passphrase);
      setIsUnlocked(true);
    } catch (err) {
      console.error("Failed to unlock encryption:", err);
      setError(
        err instanceof Error ? err.message : "Failed to unlock encryption",
      );
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Lock encryption
   */
  const lock = useCallback(() => {
    lockEncryption();
    setIsUnlocked(false);
    setError(null);
  }, []);

  return (
    <EncryptionContext.Provider
      value={{
        isInitialized,
        isUnlocked,
        initialize,
        unlock,
        lock,
        error,
        isLoading,
      }}
    >
      {children}
    </EncryptionContext.Provider>
  );
}

/**
 * Hook to access encryption context
 *
 * @example
 * const { isInitialized, isUnlocked, initialize, unlock, lock } = useEncryption();
 *
 * if (!isInitialized) {
 *   await initialize('my-passphrase');
 * } else if (!isUnlocked) {
 *   await unlock('my-passphrase');
 * }
 */
export const useEncryption = () => useContext(EncryptionContext);
