import { useHostQuery, useHostMutation } from "@/data/host";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@wystack/ui-react";
import { useEffect, useMemo, useRef } from "react";

import { useToastStore } from "@/lib/stores";
import { useAssistantStore } from "@/lib/stores/assistant-store";

export function AssistantModelPicker() {
  const configsResult = useHostQuery("listAssistantProviderConfigs");
  const catalogResult = useHostQuery("listAssistantProviderCatalog");
  const { mutateAsync: saveConfigMutation } = useHostMutation(
    "saveAssistantProviderConfig",
  );
  const { mutateAsync: setDefaultModelMutation } = useHostMutation(
    "setAssistantDefaultModel",
  );
  const selectedProviderConfigId = useAssistantStore(
    (s) => s.selectedProviderConfigId,
  );
  const selectedModelId = useAssistantStore((s) => s.selectedModelId);
  const setSelectedModel = useAssistantStore((s) => s.setSelectedModel);
  const showError = useToastStore((s) => s.showError);
  const pendingModelMutationsRef = useRef(
    new Map<string, { defaultModel: string; expectedDefaultModel: string }>(),
  );
  const persistedModelsRef = useRef(new Map<string, string>());
  const inFlightModelConfigIdsRef = useRef(new Set<string>());
  const drainingModelMutationsRef = useRef(false);
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
    for (const config of configs) {
      if (
        pendingModelMutationsRef.current.has(config.id) ||
        inFlightModelConfigIdsRef.current.has(config.id)
      ) {
        continue;
      }
      persistedModelsRef.current.set(config.id, config.defaultModel);
    }
  }, [configs]);

  function queueModelMutation(id: string, defaultModel: string) {
    const expectedDefaultModel =
      persistedModelsRef.current.get(id) ??
      configs.find((config) => config.id === id)?.defaultModel;
    if (!expectedDefaultModel) return;

    pendingModelMutationsRef.current.set(id, {
      defaultModel,
      expectedDefaultModel,
    });
    if (drainingModelMutationsRef.current) return;

    drainingModelMutationsRef.current = true;
    void (async () => {
      try {
        while (pendingModelMutationsRef.current.size > 0) {
          const next = pendingModelMutationsRef.current.entries().next().value;
          if (!next) break;
          const [configId, mutation] = next;
          pendingModelMutationsRef.current.delete(configId);
          inFlightModelConfigIdsRef.current.add(configId);
          try {
            await setDefaultModelMutation({
              input: { id: configId, ...mutation },
            });
            persistedModelsRef.current.set(configId, mutation.defaultModel);
            const newer = pendingModelMutationsRef.current.get(configId);
            if (newer) {
              pendingModelMutationsRef.current.set(configId, {
                ...newer,
                expectedDefaultModel: mutation.defaultModel,
              });
            }
          } catch (error) {
            // The write did not land, so the baseline must not advance to the
            // model we tried to store. But it must not stay either: a rejection
            // most often means another writer moved the row, and replaying the
            // same stale `expectedDefaultModel` would be rejected forever,
            // leaving the picker permanently unable to save. Drop the baseline
            // and refetch so the next selection compares against what the
            // server actually holds.
            persistedModelsRef.current.delete(configId);
            configsResult.refetch().catch(() => undefined);
            showError("Failed to set assistant model", {
              description:
                error instanceof Error ? error.message : "Please try again.",
            });
          } finally {
            inFlightModelConfigIdsRef.current.delete(configId);
          }
        }
      } finally {
        drainingModelMutationsRef.current = false;
      }
    })();
  }

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
          queueModelMutation(selected.id, defaultModel);
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
