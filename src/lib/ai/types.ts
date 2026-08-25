export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiGenerateRequest {
  messages?: AiMessage[];
  prompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stop?: string[];
  operation?: "generate" | "analyze";
  complexity?: "basic" | "standard" | "advanced";
}

export interface AiGenerateResponse {
  id: string;
  content: string;
  model: string;
  provider: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  finishReason: string | null;
  latencyMs: number;
}

export interface AiStreamDelta { type: "delta"; content: string; }
export interface AiStreamDone {
  type: "done";
  id: string;
  model: string;
  provider: string;
  content: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  finishReason: string | null;
  latencyMs: number;
}
export interface AiStreamError {
  type: "error";
  code: AiProviderError["code"];
  message: string;
  retryable: boolean;
}
export type AiStreamEvent = AiStreamDelta | AiStreamDone | AiStreamError;

export interface AiProviderError {
  code: "PROVIDER_UNAVAILABLE" | "TIMEOUT" | "RATE_LIMITED" | "INVALID_REQUEST" | "AUTH_ERROR" | "CONTENT_FILTER" | "UNKNOWN";
  message: string;
  provider?: string;
  retryable: boolean;
  statusCode?: number;
}

export interface AiStreamOptions { signal?: AbortSignal; }

export interface AiProvider {
  name: string;
  isAvailable(): Promise<boolean>;
  generate(req: AiGenerateRequest): Promise<AiGenerateResponse>;
  listModels(): Promise<string[]>;
  streamGenerate?(req: AiGenerateRequest, options?: AiStreamOptions): AsyncGenerator<AiStreamEvent, void, unknown>;
}

export type ProviderName = "openai" | "anthropic" | "google" | "xai" | "openrouter" | "mock";
