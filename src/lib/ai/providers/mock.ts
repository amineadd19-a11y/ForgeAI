import {
  AiGenerateRequest,
  AiGenerateResponse,
  AiProvider,
} from "../types";

/**
 * Mock provider for local development and tests.
 * NEVER used in production when real credentials are present.
 * Does not fake "AI" intelligence — returns deterministic structured output
 * so the platform can be exercised end-to-end without external keys.
 */
export class MockProvider implements AiProvider {
  name = "mock";

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async listModels(): Promise<string[]> {
    return ["mock-model-v1"];
  }

  async generate(req: AiGenerateRequest): Promise<AiGenerateResponse> {
    const start = Date.now();
    await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));

    const prompt =
      req.prompt ||
      req.messages?.map((m) => m.content).join("\n") ||
      "";

    const content = `[MockProvider] Echo: ${prompt.slice(0, 500)}${
      prompt.length > 500 ? "…" : ""
    }\n\nThis is a deterministic mock response for development and testing. Configure AI_PROVIDER and AI_API_KEY for real inference.`;

    const inputTokens = Math.ceil(prompt.length / 4);
    const outputTokens = Math.ceil(content.length / 4);

    return {
      id: `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      content,
      model: req.model || "mock-model-v1",
      provider: this.name,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      finishReason: "stop",
      latencyMs: Date.now() - start,
    };
  }
}
