import {
  getModels,
  setBedrockProviderModule,
  streamSimple,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  type KnownProvider,
  type Model,
  type SimpleStreamOptions,
  type Usage,
} from "@earendil-works/pi-ai";

type ProviderUnderTest = Extract<KnownProvider, "anthropic" | "amazon-bedrock">;

export interface ProviderMeasurementSpec {
  provider: ProviderUnderTest;
  modelId?: string;
  label?: string;
  options?: SimpleStreamOptions;
}

export interface ProviderMeasurementResult {
  label: string;
  provider: ProviderUnderTest;
  modelId: string;
  ok: boolean;
  startedAt: string;
  durationMs: number;
  timeToFirstTokenMs: number | null;
  textDeltaCount: number;
  outputPreview: string;
  stopReason?: AssistantMessage["stopReason"];
  usage?: Usage;
  error?: string;
}

const DEFAULT_PROMPT =
  "You are testing a DashFrame design assistant provider loop. " +
  "Return exactly one concise JSON object with keys intent, edits, and risk.";

const DEFAULT_MODELS: Record<ProviderUnderTest, string[]> = {
  anthropic: [
    "claude-haiku-4-5",
    "claude-3-5-haiku-latest",
    "claude-sonnet-4-5",
  ],
  "amazon-bedrock": [
    "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    "global.anthropic.claude-haiku-4-5-20251001-v1:0",
    "anthropic.claude-haiku-4-5-20251001-v1:0",
    "amazon.nova-micro-v1:0",
  ],
};

function findModel(
  provider: ProviderUnderTest,
  requested?: string,
): Model<Api> {
  const models = getModels(provider) as Model<Api>[];
  const model =
    requested !== undefined
      ? models.find((candidate) => candidate.id === requested)
      : DEFAULT_MODELS[provider]
          .map((id) => models.find((candidate) => candidate.id === id))
          .find((candidate) => candidate !== undefined);

  if (!model) {
    const suffix = requested ? ` ${requested}` : "";
    throw new Error(`No ${provider}${suffix} model is registered in pi-ai`);
  }
  return model as Model<Api>;
}

function measurementContext(prompt = DEFAULT_PROMPT): Context {
  return {
    systemPrompt:
      "Measure provider streaming and usage. Do not call tools or include prose.",
    messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failedMeasurement(args: {
  label: string;
  provider: ProviderUnderTest;
  modelId: string;
  startedAtMs: number;
  startedAt: string;
  error: unknown;
}): ProviderMeasurementResult {
  return {
    label: args.label,
    provider: args.provider,
    modelId: args.modelId,
    ok: false,
    startedAt: args.startedAt,
    durationMs: Math.round(performance.now() - args.startedAtMs),
    timeToFirstTokenMs: null,
    textDeltaCount: 0,
    outputPreview: "",
    stopReason: "error",
    error: errorMessage(args.error),
  };
}

export async function measureAssistantStream(args: {
  label: string;
  provider: ProviderUnderTest;
  modelId: string;
  stream: AssistantMessageEventStream;
}): Promise<ProviderMeasurementResult> {
  const startedAtMs = performance.now();
  const startedAt = new Date().toISOString();
  let firstTokenAtMs: number | null = null;
  let textDeltaCount = 0;
  let output = "";
  let finalMessage: AssistantMessage | undefined;
  let streamError: string | undefined;

  try {
    for await (const event of args.stream as AsyncIterable<AssistantMessageEvent>) {
      if (event.type === "text_delta") {
        firstTokenAtMs ??= performance.now();
        textDeltaCount += 1;
        output += event.delta;
      } else if (event.type === "text_end" && output.length === 0) {
        output = event.content;
      } else if (event.type === "done") {
        finalMessage = event.message;
      } else if (event.type === "error") {
        finalMessage = event.error;
        streamError = event.error.errorMessage ?? event.reason;
      }
    }
    finalMessage ??= await args.stream.result();
  } catch (error) {
    streamError = errorMessage(error);
  }

  const durationMs = Math.round(performance.now() - startedAtMs);
  const stopReason = finalMessage?.stopReason;
  return {
    label: args.label,
    provider: args.provider,
    modelId: args.modelId,
    ok: streamError === undefined && stopReason !== "error",
    startedAt,
    durationMs,
    timeToFirstTokenMs:
      firstTokenAtMs === null ? null : Math.round(firstTokenAtMs - startedAtMs),
    textDeltaCount,
    outputPreview: output.slice(0, 500),
    stopReason,
    usage: finalMessage?.usage,
    error: streamError ?? finalMessage?.errorMessage,
  };
}

export async function installBedrockProvider(): Promise<void> {
  const { bedrockProviderModule } =
    await import("@earendil-works/pi-ai/bedrock-provider");
  setBedrockProviderModule(bedrockProviderModule);
}

export async function measureProviderRun(
  spec: ProviderMeasurementSpec,
  prompt = DEFAULT_PROMPT,
): Promise<ProviderMeasurementResult> {
  const label = spec.label ?? spec.provider;
  const startedAtMs = performance.now();
  const startedAt = new Date().toISOString();
  try {
    if (spec.provider === "amazon-bedrock") {
      await installBedrockProvider();
    }

    const model = findModel(spec.provider, spec.modelId);
    const stream = streamSimple(model, measurementContext(prompt), {
      maxTokens: 256,
      temperature: 0,
      timeoutMs: 30_000,
      maxRetries: 0,
      ...spec.options,
    });

    return measureAssistantStream({
      label,
      provider: spec.provider,
      modelId: model.id,
      stream,
    });
  } catch (error) {
    return failedMeasurement({
      label,
      provider: spec.provider,
      modelId: spec.modelId ?? "default",
      startedAtMs,
      startedAt,
      error,
    });
  }
}

export async function measureProviderRuns(
  args: {
    prompt?: string;
    specs?: ProviderMeasurementSpec[];
  } = {},
): Promise<ProviderMeasurementResult[]> {
  const specs = args.specs ?? [
    {
      provider: "anthropic",
      modelId: process.env.DASHFRAME_ANTHROPIC_MODEL,
      label: "anthropic-direct",
    },
    {
      provider: "amazon-bedrock",
      modelId: process.env.DASHFRAME_BEDROCK_MODEL,
      label: "bedrock",
      options: {
        env: {
          ...(process.env.AWS_REGION
            ? { AWS_REGION: process.env.AWS_REGION }
            : {}),
          ...(process.env.AWS_PROFILE
            ? { AWS_PROFILE: process.env.AWS_PROFILE }
            : {}),
        },
      },
    },
  ];

  const results: ProviderMeasurementResult[] = [];
  for (const spec of specs) {
    results.push(await measureProviderRun(spec, args.prompt));
  }
  return results;
}
