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
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  finishReason: string | null;
  latencyMs: number;
}

export interface AiProviderError {
  code:
    | "PROVIDER_UNAVAILABLE"
    | "TIMEOUT"
    | "RATE_LIMITED"
    | "INVALID_REQUEST"
    | "AUTH_ERROR"
    | "CONTENT_FILTER"
    | "UNKNOWN";
  message: string;
  provider?: string;
  retryable: boolean;
  statusCode?: number;
}

export interface AiProvider {
  name: string;
  isAvailable(): Promise<boolean>;
  generate(req: AiGenerateRequest): Promise<AiGenerateResponse>;
  listModels(): Promise<string[]>;
}

export type ProviderName = "openai" | "anthropic" | "google" | "mock";
