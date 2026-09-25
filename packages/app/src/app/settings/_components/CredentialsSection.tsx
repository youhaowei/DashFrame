import { AccessCredentialsDialog } from "@/components/access-credentials/AccessCredentialsDialog";
import {
  useAccessCapabilities,
  useAccessCredentialMutations,
  useAccessCredentials,
} from "@/data";
import { queryStatus } from "@/data/query-status";
import {
  getConnectorById,
  useRegistryVersion,
} from "@/lib/connectors/registry";
import { useToastStore } from "@/lib/stores";
import { api } from "@dashframe/convex-backend/api";
import type {
  AccessCapabilities,
  AccessCredential,
  UUID,
} from "@dashframe/types";
import { Link } from "@tanstack/react-router";
import { Button, Input } from "@wystack/ui-react";
import { AlertCircleIcon, CheckIcon, CopyIcon } from "@wystack/ui-react/icons";
import { useQuery_experimental as useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";

import {
  SettingsField,
  SettingsListRow,
  SettingsSection,
} from "./SettingsSection";

export const SECRET_KEY_COMMAND = "openssl rand -base64 32";

const COPY_LABEL = {
  idle: "Copy command",
  copied: "Copied",
  failed: "Couldn't copy",
} as const;

/** The host started without a secret key, so nothing can be stored encrypted. */
export function isSecretKeyMissing(
  capabilities: AccessCapabilities | undefined,
): boolean {
  return capabilities?.unavailableReason === "no-secret-key";
}

/**
 * What the host keeps encrypted with its secret key: access credentials issued
 * to applications that connect to DashFrame, and the sign-ins data sources use
 * to reach their services. Only what the host can list is shown; a data
 * source's sign-in is managed on that data source.
 */
export function CredentialsSection() {
  const capabilities = useAccessCapabilities().data;
  const canManage = capabilities?.canManageCredentials === true;

  return (
    <SettingsSection
      id="credentials"
      title="Credentials"
      description="Access credentials for applications that connect to DashFrame, and the sign-ins your data sources use."
    >
      <div className="flex flex-col gap-5">
        {isSecretKeyMissing(capabilities) && <SecretKeyMissing />}
        {capabilities?.unavailableReason === "no-host-token" && (
          <p className="text-sm text-neutral-fg-subtle">
            Access credentials need a host started with an access token (
            <code className="font-mono text-xs">--token</code>). Without one,
            the host accepts every local request anonymously.
          </p>
        )}
        {capabilities?.unavailableReason === "not-owner" && (
          <p className="text-sm text-neutral-fg-subtle">
            Only the workspace owner can manage access credentials.
          </p>
        )}
        {canManage && <AccessCredentialList />}
        <DataSourceSignIns />
      </div>
    </SettingsSection>
  );
}

function SecretKeyMissing() {
  const [copied, setCopied] = useCopied();
  return (
    <div
      role="status"
      className="flex gap-2.5 rounded-[var(--inner-radius)] bg-palette-warning/10 p-3 text-sm"
    >
      <AlertCircleIcon
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-palette-warning"
      />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-neutral-fg">
          Credentials are unavailable: no secret key configured
        </p>
        <p className="mt-0.5 mb-2.5 text-neutral-fg-subtle">
          The host stores credentials and data-source sign-ins encrypted with a
          secret key. Set{" "}
          <code className="font-mono text-xs">DASHFRAME_SECRET_KEY</code> (a
          base64-encoded 32-byte key) or{" "}
          <code className="font-mono text-xs">DASHFRAME_SECRET_KEY_FILE</code>,
          then restart the host. This command generates a key:
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            readOnly
            value={SECRET_KEY_COMMAND}
            aria-label="Command that generates a secret key"
            className="min-w-44 flex-1 font-mono text-xs"
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button
            variant="outline"
            color="secondary"
            size="sm"
            icon={copied === "copied" ? CheckIcon : CopyIcon}
            label={COPY_LABEL[copied]}
            onClick={() => setCopied(SECRET_KEY_COMMAND)}
          />
        </div>
      </div>
    </div>
  );
}

function AccessCredentialList() {
  const credentials = useAccessCredentials();
  const { revoke } = useAccessCredentialMutations();
  const [issueOpen, setIssueOpen] = useState(false);
  const [busyId, setBusyId] = useState<UUID | null>(null);
  const { showError } = useToastStore();
  const active = (credentials.data ?? []).filter((c) => !c.revokedAt);

  const handleRevoke = async (id: UUID) => {
    setBusyId(id);
    try {
      await revoke(id);
    } catch {
      showError("Couldn't revoke the credential. Please try again.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SettingsField label="Access credentials">
      <CredentialRows
        failed={credentials.isError === true}
        onRetry={credentials.refetch}
        loading={credentials.isLoading}
        credentials={active}
        busyId={busyId}
        onRevoke={handleRevoke}
      />
      <Button
        variant="outline"
        color="secondary"
        size="sm"
        label="Issue credential…"
        aria-haspopup="dialog"
        onClick={() => setIssueOpen(true)}
        className="self-start"
      />
      <AccessCredentialsDialog open={issueOpen} onOpenChange={setIssueOpen} />
    </SettingsField>
  );
}

function CredentialRows({
  failed,
  onRetry,
  loading,
  credentials,
  busyId,
  onRevoke,
}: {
  failed: boolean;
  onRetry: () => unknown;
  loading: boolean;
  credentials: readonly AccessCredential[];
  busyId: UUID | null;
  onRevoke: (id: UUID) => Promise<void>;
}) {
  if (loading)
    return <p className="text-sm text-neutral-fg-subtle">Loading…</p>;
  if (failed)
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-fg-subtle">
        <span role="alert">Couldn't load access credentials.</span>
        <Button
          variant="ghost"
          color="secondary"
          size="sm"
          label="Try again"
          onClick={onRetry}
        />
      </div>
    );
  if (credentials.length === 0)
    return (
      <p className="text-sm text-neutral-fg-subtle">
        No access credentials issued.
      </p>
    );
  return (
    <ul className="flex flex-col">
      {credentials.map((credential) => (
        <SettingsListRow
          key={credential.id}
          name={credential.name}
          meta={`${credential.tokenPrefix}… · issued ${new Date(
            credential.createdAt,
          ).toLocaleDateString()}`}
          actions={
            <Button
              variant="ghost"
              color="danger"
              size="sm"
              label={busyId === credential.id ? "Revoking…" : "Revoke"}
              disabled={busyId !== null}
              onClick={() => onRevoke(credential.id)}
            />
          }
        />
      ))}
    </ul>
  );
}

/** Data sources that keep a sign-in in the host's encrypted store. */
function DataSourceSignIns() {
  useRegistryVersion();
  const { data: sources } = queryStatus(
    useQuery({ query: api.app.listDataSources, args: {} }),
  );
  const withSignIn = (sources ?? []).filter(
    (source) => source.config.hasApiKey || source.config.hasConnectionString,
  );
  if (withSignIn.length === 0) return null;
  return (
    <SettingsField label="Data source sign-ins">
      <ul className="flex flex-col">
        {withSignIn.map((source) => (
          <SettingsListRow
            key={source.id}
            name={
              <Link
                to={`/data-sources/${source.id}` as never}
                className="rounded-sm hover:underline focus-visible:ring-2 focus-visible:ring-neutral-ring focus-visible:outline-none"
              >
                {source.name}
              </Link>
            }
            meta={getConnectorById(source.type)?.name ?? source.type}
          />
        ))}
      </ul>
    </SettingsField>
  );
}

type CopyState = "idle" | "copied" | "failed";

/** Copies text and reports the outcome for a moment. */
function useCopied(): [CopyState, (text: string) => Promise<void>] {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (text: string) => {
    let next: CopyState = "copied";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      next = "failed";
    }
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1500);
  };
  return [state, copy];
}
