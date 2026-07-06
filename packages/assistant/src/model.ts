import { getModels, type Api, type Model } from "@earendil-works/pi-ai";

const DEFAULT_ANTHROPIC_MODELS = [
  "claude-haiku-4-5",
  "claude-3-5-haiku-latest",
  "claude-sonnet-4-5",
] as const;

export function resolveDefaultAnthropicModel(
  requestedModelId?: string,
): Model<Api> {
  const models = getModels("anthropic") as Model<Api>[];
  const model =
    (requestedModelId
      ? models.find((candidate) => candidate.id === requestedModelId)
      : undefined) ??
    DEFAULT_ANTHROPIC_MODELS.map((id) =>
      models.find((candidate) => candidate.id === id),
    ).find((candidate): candidate is Model<Api> => candidate !== undefined);

  if (!model) {
    throw new Error("No supported Anthropic model is registered in pi-ai");
  }
  return model;
}
