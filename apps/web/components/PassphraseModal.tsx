"use client";

import { useEncryption } from "@/lib/contexts/encryption-context";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@dashframe/ui";
import { useState } from "react";

interface PassphraseModalProps {
  /**
   * Whether the modal is open
   */
  isOpen: boolean;
}

/**
 * PassphraseModal component
 *
 * Modal for setting up or unlocking encryption with a passphrase.
 * Shows different views based on encryption initialization state:
 * - Setup view: Create new passphrase with confirmation (first-time)
 * - Unlock view: Enter existing passphrase
 *
 * @example
 * ```tsx
 * <PassphraseModal isOpen={!isUnlocked} />
 * ```
 */
export function PassphraseModal({ isOpen }: PassphraseModalProps) {
  const { isInitialized, initialize, unlock, error, isLoading } =
    useEncryption();

  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  /**
   * Handle form submission for both setup and unlock
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    // Validate passphrase length
    if (!passphrase || passphrase.length < 8) {
      setValidationError("Passphrase must be at least 8 characters");
      return;
    }

    try {
      if (isInitialized) {
        // Unlock with existing passphrase
        await unlock(passphrase);
        // Reset form on success (modal closes automatically via derived state)
        setPassphrase("");
      } else {
        // Setup new passphrase - validate confirmation
        if (passphrase !== confirmPassphrase) {
          setValidationError("Passphrases do not match");
          return;
        }

        await initialize(passphrase);
        // Reset form on success (modal closes automatically via derived state)
        setPassphrase("");
        setConfirmPassphrase("");
      }
    } catch (err) {
      // Error state is managed by EncryptionContext and displayed via the error prop
      // Log for debugging purposes
      console.error("Passphrase operation failed:", err);
    }
  };

  const handleOpenChange = (open: boolean) => {
    // Prevent closing the modal - user must unlock/initialize
    // Modal closes automatically via derived state when unlocked
    if (!open) {
      return;
    }
  };

  // Display error from context or local validation error
  const displayError = validationError || error;

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {isInitialized ? "Unlock Encryption" : "Setup Encryption"}
            </DialogTitle>
            <DialogDescription>
              {isInitialized
                ? "Enter your passphrase to access encrypted data"
                : "Create a passphrase to encrypt sensitive data. You'll need this passphrase to access your data in future sessions."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Passphrase field */}
            <div className="space-y-2">
              <Label htmlFor="passphrase">
                {isInitialized ? "Passphrase" : "Create passphrase"}
              </Label>
              <Input
                id="passphrase"
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Enter passphrase (min 8 characters)"
                autoFocus
                disabled={isLoading}
                required
              />
            </div>

            {/* Confirmation field - only for setup */}
            {!isInitialized && (
              <div className="space-y-2">
                <Label htmlFor="confirmPassphrase">Confirm passphrase</Label>
                <Input
                  id="confirmPassphrase"
                  type="password"
                  value={confirmPassphrase}
                  onChange={(e) => setConfirmPassphrase(e.target.value)}
                  placeholder="Re-enter passphrase"
                  disabled={isLoading}
                  required
                />
              </div>
            )}

            {/* Error display */}
            {displayError && (
              <div className="rounded-xl bg-red-50 p-4 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-200">
                {displayError}
              </div>
            )}

            {/* Warning for setup */}
            {!isInitialized && (
              <div className="rounded-xl bg-yellow-50 p-4 text-sm text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
                <strong>Important:</strong> There is no way to recover your data
                if you forget this passphrase. Please store it securely.
              </div>
            )}
          </div>

          <DialogFooter>
            <button
              type="submit"
              disabled={isLoading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
            >
              {isLoading && (
                <svg
                  className="h-4 w-4 animate-spin"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              )}
              {isInitialized ? "Unlock" : "Create"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
