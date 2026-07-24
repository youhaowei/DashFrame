import { useMutation, useQuery } from "@wystack/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@wystack/ui-react";
import { useEffect, useMemo } from "react";

import { useToastStore } from "@/lib/stores";
import { useAssistantStore } from "@/lib/stores/assistant-store";
import { api } from "@/wystack/api";

export function AssistantModelPicker() {
  const configsResult = useQuery(api.listAssistantProviderConfigs);
  const catalogResult = useQuery(api.listAssistantProviderCatalog);
  const { mutateAsync: saveConfigMutation } = useMutation(
    api.saveAssistantProviderConfig,
  );
  const { mutateAsync: setDefaultModelMutation } = useMutation(
    api.setAssistantDefaultModel,
  );
  const selectedProviderConfigId = useAssistantStore(
    (s) => s.selectedProviderConfigId,
  );
  const selectedModelId = useAssistantStore((s) => s.selectedModelId);
  const setSelectedModel = useAssistantStore((s) => s.setSelectedModel);
  const showError = useToastStore((s) => s.showError);
  const configs = useMemo(() => configsResult.data ?? [], [configsResult.data]);
  const catalog = useMemo(() => catalogResult.data ?? [], [catalogResult.data]);
  const configsLoaded =
    configsResult.data !== undefined && !configsResult.isLoading;
  const selected =
    configs.find((config) => config.id === selectedProviderConfigId) ??
    configs.find((config) => config.isDefault) ??
    configs[0];
  const activeModel =
    selectedProviderConfigId === selected?.id
      ? (selectedModelId ?? selected.defaultModel)
      : selected?.defaultModel;

  const models = useMemo(() => {
    const entry = catalog.find(
      (candidate) => candidate.providerId === selected?.providerId,
    );
    return entry?.models ?? [];
  }, [catalog, selected?.providerId]);

  useEffect(() => {
    if (!selected) return;
    const storedConfigMissing =
      configsLoaded &&
      selectedProviderConfigId !== null &&
      configs.every((config) => config.id !== selectedProviderConfigId);
    if (!storedConfigMissing && activeModel) return;
    setSelectedModel(selected.id, selected.defaultModel);
  }, [
    activeModel,
    configs,
    configsLoaded,
    selected,
    selectedProviderConfigId,
    setSelectedModel,
  ]);

  if (!selected) {
    return (
      <span className="max-w-32 truncate rounded-md bg-neutral-bg-muted px-2 py-1 text-[11px] text-neutral-fg-subtle">
        No model
      </span>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      <Select
        value={selected.id}
        onValueChange={(id) => {
          if (!id) return;
          const next = configs.find((config) => config.id === id);
          if (next) {
            setSelectedModel(next.id, next.defaultModel);
            // Selecting a provider also persists it as the default — the
            // picker is the "active provider" control, not a per-run choice.
            saveConfigMutation({ input: { ...next, isDefault: true } }).catch(
              (error) => {
                showError("Failed to switch assistant provider", {
                  description:
                    error instanceof Error
                      ? error.message
                      : "Please try again.",
                });
              },
            );
          }
        }}
      >
        <SelectTrigger className="h-7 w-28 px-2 text-[11px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {configs.map((config) => (
            <SelectItem key={config.id} value={config.id}>
              {config.displayLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={activeModel}
        onValueChange={(defaultModel) => {
          if (!defaultModel) return;
          setSelectedModel(selected.id, defaultModel);
          setDefaultModelMutation({
            input: { id: selected.id, defaultModel },
          }).catch((error) => {
            showError("Failed to set assistant model", {
              description:
                error instanceof Error ? error.message : "Please try again.",
            });
          });
        }}
      >
        <SelectTrigger className="h-7 w-32 px-2 text-[11px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {models.slice(0, 80).map((model) => (
            <SelectItem key={model.id} value={model.id}>
              {model.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
