import {
  useAccessConnectionInfo,
  useAccessCredentialMutations,
  useAccessCredentials,
} from "@dashframe/core";
import type { IssuedAccessCredential, UUID } from "@dashframe/types";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@wystack/ui-react";
import { useEffect, useRef, useState } from "react";

interface AccessCredentialsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AccessCredentialsDialog({
  open,
  onOpenChange,
}: AccessCredentialsDialogProps) {
  const connection = useAccessConnectionInfo();
  const credentials = useAccessCredentials();
  const { issue, revoke } = useAccessCredentialMutations();
  const [name, setName] = useState("");
  const [issued, setIssued] = useState<IssuedAccessCredential | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"endpoint" | "credential" | null>(null);
  const issuedCredentials = credentials.data ?? [];
  // Live mirror of `open` so an in-flight issuance can tell whether the dialog
  // was closed before it resolved (the async closure captures a stale `open`).
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const copy = async (kind: "endpoint" | "credential", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
    } catch {
      setError("Couldn't copy to the clipboard. Select and copy it manually.");
    }
  };

  const handleIssue = async () => {
    if (!name.trim()) return;
    setBusyId("issue");
    setError(null);
    try {
      const credential = await issue(name);
      await credentials.refetch();
      setName("");
      // If the dialog was closed while issuance was in flight, honor that
      // discard rather than resurfacing the one-time secret on reopen.
      if (openRef.current) setIssued(credential);
    } catch {
      setError("Couldn't issue the credential. Please try again.");
    } finally {
      setBusyId(null);
    }
  };

  const handleRevoke = async (id: UUID) => {
    setBusyId(id);
    setError(null);
    try {
      await revoke(id);
      await credentials.refetch();
    } catch {
      setError("Couldn't revoke the credential. Please try again.");
    } finally {
      setBusyId(null);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setIssued(null);
      setCopied(null);
      setError(null);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Access credentials</DialogTitle>
          <DialogDescription>
            Issue named, revocable credentials for applications that connect to
            DashFrame.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {connection.data && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Connection</h3>
              <div className="rounded-lg border border-neutral-border bg-neutral-bg-muted p-3 text-xs">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <code className="min-w-0 truncate">
                    {connection.data.endpoint}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    label={copied === "endpoint" ? "Copied" : "Copy"}
                    onClick={() => copy("endpoint", connection.data!.endpoint)}
                  />
                </div>
                <p className="text-neutral-fg-subtle">
                  {connection.data.transport} · Bearer authentication
                </p>
                <p className="mt-2 text-neutral-fg-subtle">
                  WebSocket:{" "}
                  <code>
                    {connection.data.endpoint.replace(/^http/, "ws")}/ws
                  </code>
                </p>
              </div>
            </section>
          )}

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Issue credential</h3>
              <p className="text-xs text-neutral-fg-subtle">
                Use a name that identifies the client and machine.
              </p>
            </div>
            <div className="flex gap-2">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Reporting client on MacBook"
                maxLength={80}
              />
              <Button
                label={busyId === "issue" ? "Issuing…" : "Issue"}
                disabled={!name.trim() || busyId !== null}
                onClick={handleIssue}
              />
            </div>
          </section>

          {issued && (
            <section className="space-y-2 rounded-lg border border-palette-warning/40 bg-palette-warning/10 p-3">
              <h3 className="text-sm font-semibold">
                Copy this credential now
              </h3>
              <p className="text-xs text-neutral-fg-subtle">
                DashFrame stores its verifier in the secret vault. This value
                cannot be shown again.
              </p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded bg-neutral-bg px-2 py-2 text-xs">
                  {issued.accessCredential}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  label={copied === "credential" ? "Copied" : "Copy"}
                  onClick={() => copy("credential", issued.accessCredential)}
                />
              </div>
            </section>
          )}

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Issued credentials</h3>
            {credentials.isLoading && (
              <p className="text-xs text-neutral-fg-subtle">Loading…</p>
            )}
            {!credentials.isLoading && issuedCredentials.length > 0 && (
              <div className="divide-y divide-neutral-border rounded-lg border border-neutral-border">
                {issuedCredentials.map((credential) => (
                  <div
                    key={credential.id}
                    className="flex items-center justify-between gap-3 p-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {credential.name}
                        </span>
                        <Badge variant="soft">
                          {credential.revokedAt ? "Revoked" : "Active"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-neutral-fg-subtle">
                        {credential.tokenPrefix}… · issued{" "}
                        {new Date(credential.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    {!credential.revokedAt && (
                      <Button
                        size="sm"
                        color="danger"
                        variant="outline"
                        label={
                          busyId === credential.id ? "Revoking…" : "Revoke"
                        }
                        disabled={busyId !== null}
                        onClick={() => handleRevoke(credential.id)}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
            {!credentials.isLoading && issuedCredentials.length === 0 && (
              <p className="text-xs text-neutral-fg-subtle">
                No access credentials issued.
              </p>
            )}
          </section>

          {error && <p className="text-sm text-palette-danger">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            label="Done"
            onClick={() => handleOpenChange(false)}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
