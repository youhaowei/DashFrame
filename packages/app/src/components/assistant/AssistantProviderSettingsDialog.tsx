import { useHostQuery, useHostMutation } from "@/data/host";
import type {
  AssistantProviderAuthKind,
  AssistantProviderCatalogEntry,
  UUID,
} from "@dashframe/types";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@wystack/ui-react";
import {
  DeleteIcon,
  ExternalLinkIcon,
  PlusIcon,
} from "@wystack/ui-react/icons";
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { useToastStore } from "@/lib/stores";

interface AssistantProviderSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface DraftProviderForm {
  id?: UUID;
  providerId: string;
  displayLabel: string;
  authKind: AssistantProviderAuthKind;
  baseUrl: string;
  credential: string;
  defaultModel: string;
}

function firstModel(catalog?: AssistantProviderCatalogEntry): string {
  return catalog?.models[0]?.id ?? "";
}

function formFromCatalog(
  catalog: AssistantProviderCatalogEntry[],
): DraftProviderForm {
  const first = catalog[0];
  return {
    providerId: first?.providerId ?? "anthropic",
    displayLabel: first?.label ?? "Anthropic",
    authKind: first?.authKinds[0] ?? "api-key",
    baseUrl: first?.defaultBaseUrl ?? "",
    credential: "",
    defaultModel: firstModel(first),
  };
}

export function AssistantProviderSettingsDialog({
  open,
  onOpenChange,
}: AssistantProviderSettingsDialogProps) {
  const catalogResult = useHostQuery("listAssistantProviderCatalog");
  const configsResult = useHostQuery("listAssistantProviderConfigs");
  const { mutateAsync: saveConfigMutation } = useHostMutation(
    "saveAssistantProviderConfig",
  );
  const { mutateAsync: removeConfigMutation } = useHostMutation(
    "removeAssistantProviderConfig",
  );
  const { mutateAsync: startOAuthLoginMutation } = useHostMutation(
    "startAssistantOAuthLogin",
  );
  const { showError, showSuccess } = useToastStore();
  const catalog = useMemo(() => catalogResult.data ?? [], [catalogResult.data]);
  const configs = useMemo(() => configsResult.data ?? [], [configsResult.data]);
  // The form derives from the catalog until the user edits it; the first
  // edit pins it as an override so a late-arriving catalog can't clobber
  // user input.
  const [formOverride, setFormOverride] = useState<DraftProviderForm | null>(
    null,
  );
  const form = formOverride ?? formFromCatalog(catalog);
  const setForm: Dispatch<SetStateAction<DraftProviderForm>> = (action) => {
    setFormOverride((current) => {
      const base = current ?? formFromCatalog(catalog);
      return typeof action === "function" ? action(base) : action;
    });
  };
  const [saving, setSaving] = useState(false);

  const selectedCatalog = useMemo(
    () => catalog.find((entry) => entry.providerId === form.providerId),
    [catalog, form.providerId],
  );
  const selectedCatalogIsLocal =
    selectedCatalog?.authKinds.includes("local") || form.authKind === "local";

  function chooseProvider(providerId: string | null) {
    if (!providerId) return;
    const entry = catalog.find(
      (candidate) => candidate.providerId === providerId,
    );
    setForm({
      providerId,
      displayLabel: entry?.label ?? providerId,
      authKind: entry?.authKinds[0] ?? "api-key",
      baseUrl: entry?.defaultBaseUrl ?? "",
      credential: "",
      defaultModel: firstModel(entry),
    });
  }

  async function save() {
    setSaving(true);
    // The provider select stays live while a save is in flight. Stamping the
    // returned id onto whatever the form holds when the request lands would
    // give provider B's draft provider A's row id, and the next save would
    // overwrite A's configuration with B's data.
    const submittedProviderId = form.providerId;
    try {
      const existingConfig = configs.find(
        (config) => config.providerId === form.providerId,
      );
      const saved = await saveConfigMutation({
        input: {
          id: form.id ?? existingConfig?.id,
          providerId: form.providerId,
          displayLabel: form.displayLabel,
          authKind: form.authKind,
          baseUrl: form.baseUrl || undefined,
          credential: form.credential || undefined,
          defaultModel: form.defaultModel,
          isDefault: configs.length === 0,
        },
      });
      setForm((current) =>
        current.providerId === submittedProviderId
          ? { ...current, id: saved.id, credential: "" }
          : current,
      );
      showSuccess("Assistant provider saved");
    } catch (error) {
      showError("Failed to save assistant provider", {
        description:
          error instanceof Error ? error.message : "Please check the form.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function login(id: string) {
    setSaving(true);
    try {
      await startOAuthLoginMutation({ id });
      showSuccess("Assistant provider connected");
    } catch (error) {
      showError("Failed to connect assistant provider", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function removeProvider(id: string) {
    try {
      await removeConfigMutation({ id });
    } catch (error) {
      showError("Failed to remove assistant provider", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Assistant Providers</DialogTitle>
          <DialogDescription>
            Configure model providers and keep credentials in the local vault.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-[1fr_1.15fr]">
          <section className="space-y-2">
            {configs.length === 0 ? (
              <div className="rounded-[var(--surface-radius)] bg-neutral-bg-muted/60 p-3 text-sm text-neutral-fg-subtle">
                No providers configured.
              </div>
            ) : (
              configs.map((config) => (
                <div
                  key={config.id}
                  className="rounded-[var(--surface-radius)] bg-neutral-bg-muted/60 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-neutral-fg">
                        {config.displayLabel}
                      </div>
                      <div className="truncate text-xs text-neutral-fg-subtle">
                        {config.providerId} · {config.defaultModel}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={DeleteIcon}
                      iconOnly
                      label="Remove provider"
                      tooltip="Remove provider"
                      onClick={() => void removeProvider(config.id)}
                      className="size-7 text-neutral-fg-subtle hover:text-palette-danger"
                    />
                  </div>
                  <div className="mt-2 text-[11px] text-neutral-fg-subtle">
                    {config.hasCredential
                      ? "Credential stored"
                      : "No credential"}
                    {config.isDefault ? " · Default" : ""}
                  </div>
                  {config.authKind === "oauth" && (
                    <Button
                      variant="outline"
                      size="sm"
                      icon={ExternalLinkIcon}
                      label={config.hasCredential ? "Reconnect" : "Log in"}
                      disabled={saving}
                      onClick={() => void login(config.id)}
                      className="mt-2 h-7"
                    />
                  )}
                </div>
              ))
            )}
          </section>

          <section className="space-y-3">
            <Field>
              <FieldLabel>Provider</FieldLabel>
              <Select value={form.providerId} onValueChange={chooseProvider}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {catalog.map((entry) => (
                    <SelectItem key={entry.providerId} value={entry.providerId}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Label</FieldLabel>
              <Input
                value={form.displayLabel}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    displayLabel: event.target.value,
                  }))
                }
              />
            </Field>
            <Field>
              <FieldLabel>Auth</FieldLabel>
              <Select
                value={form.authKind}
                onValueChange={(value) => {
                  if (!value) return;
                  setForm((current) => ({
                    ...current,
                    authKind: value as AssistantProviderAuthKind,
                    credential: "",
                  }));
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {selectedCatalog?.authKinds.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {kind}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {form.authKind === "api-key" && (
              <Field>
                <FieldLabel>API key</FieldLabel>
                <Input
                  type="password"
                  value={form.credential}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      credential: event.target.value,
                    }))
                  }
                />
                <FieldDescription>
                  Write-only. Saved values are not returned to the UI.
                </FieldDescription>
              </Field>
            )}
            {(form.authKind === "local" || form.providerId === "opencode") && (
              <Field>
                <FieldLabel>Base URL</FieldLabel>
                <Input
                  value={form.baseUrl}
                  placeholder={selectedCatalog?.defaultBaseUrl}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      baseUrl: event.target.value,
                    }))
                  }
                />
              </Field>
            )}
            <Field>
              <FieldLabel>Default model</FieldLabel>
              {selectedCatalogIsLocal ? (
                <Input
                  value={form.defaultModel}
                  placeholder={firstModel(selectedCatalog)}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      defaultModel: event.target.value,
                    }))
                  }
                />
              ) : (
                <Select
                  value={form.defaultModel}
                  onValueChange={(value) => {
                    if (!value) return;
                    setForm((current) => ({
                      ...current,
                      defaultModel: value,
                    }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedCatalog?.models.slice(0, 80).map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          </section>
        </div>

        <DialogFooter>
          <Button
            icon={PlusIcon}
            label={saving ? "Saving..." : "Save provider"}
            disabled={saving || !form.defaultModel}
            onClick={save}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
