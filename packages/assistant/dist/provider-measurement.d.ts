import { type AssistantMessage, type AssistantMessageEventStream, type KnownProvider, type SimpleStreamOptions, type Usage } from "@earendil-works/pi-ai";
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
export declare function measureAssistantStream(args: {
    label: string;
    provider: ProviderUnderTest;
    modelId: string;
    stream: AssistantMessageEventStream;
}): Promise<ProviderMeasurementResult>;
export declare function installBedrockProvider(): Promise<void>;
export declare function measureProviderRun(spec: ProviderMeasurementSpec, prompt?: string): Promise<ProviderMeasurementResult>;
export declare function measureProviderRuns(args?: {
    prompt?: string;
    specs?: ProviderMeasurementSpec[];
}): Promise<ProviderMeasurementResult[]>;
export {};
//# sourceMappingURL=provider-measurement.d.ts.map