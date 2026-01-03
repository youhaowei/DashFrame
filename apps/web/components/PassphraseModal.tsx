"use client";

import { useEncryption } from "@/lib/contexts/encryption-context";
import {
  Button,
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
  /**
   * Called when the modal should close (after successful unlock/initialization)
   */
  onClose: () => void;
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
 * <PassphraseModal
 *   isOpen={!isUnlocked}
 *   onClose={() => setShowModal(false)}
 * />
 * ```
 */
export function PassphraseModal({ isOpen, onClose }: PassphraseModalProps) {
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
        // Reset form and close on success
        setPassphrase("");
        onClose();
      } else {
        // Setup new passphrase - validate confirmation
        if (passphrase !== confirmPassphrase) {
          setValidationError("Passphrases do not match");
          return;
        }

        await initialize(passphrase);
        // Reset form and close on success
        setPassphrase("");
        setConfirmPassphrase("");
        onClose();
      }
    } catch (err) {
      // Error is handled by EncryptionContext and displayed via error prop
      // No need to handle here as we show context.error below
    }
  };

  /**
   * Handle dialog close attempt
   * Only allow closing after successful unlock/initialization
   */
  const handleOpenChange = (open: boolean) => {
    // Prevent closing the modal - user must unlock/initialize
    // We only close via onClose() after successful operation
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
            <Button
              type="submit"
              label={isInitialized ? "Unlock" : "Create"}
              disabled={isLoading}
              loading={isLoading}
            />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
