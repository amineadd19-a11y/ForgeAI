"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  MODEL_CATALOG,
  providerLabel,
  type ModelCatalogEntry,
  type ModelProviderId,
} from "@/lib/config";

const MAX_PROMPT_CHARS = 100_000;

type Complexity = "basic" | "standard" | "advanced";

type PlaygroundResult = {
  content?: string;
  requestId?: string;
  provider?: string;
  model?: string;
  usage?: {
    credits?: number;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  latencyMs?: number;
  error?: string;
  streamed?: boolean;
  empty?: boolean;
};

function inferProvider(modelId: string): ModelProviderId | "unknown" {
  const entry = MODEL_CATALOG.find((m) => m.id === modelId);
  return entry?.provider ?? "unknown";
}

function groupByProvider(models: ModelCatalogEntry[]) {
  const groups: Record<string, ModelCatalogEntry[]> = {};
  for (const m of models) {
    if (!groups[m.provider]) groups[m.provider] = [];
    groups[m.provider].push(m);
  }
  return groups;
}

export default function PlaygroundPage() {
  const [prompt, setPrompt] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-4o-mini");
  const [complexity, setComplexity] = useState<Complexity>("standard");
  const [stream, setStream] = useState(true);
  const [loading, setLoading] = useState(false);
  const [liveContent, setLiveContent] = useState("");
  const [result, setResult] = useState<PlaygroundResult | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const submittingRef = useRef(false);

  const selectedProvider = inferProvider(model);
  const catalogGroups = useMemo(() => groupByProvider(MODEL_CATALOG), []);

  const creditHint =
    complexity === "basic" ? 1 : complexity === "standard" ? 2 : 5;

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    submittingRef.current = false;
    setLoading(false);
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  async function onGenerate(e?: React.FormEvent) {
    e?.preventDefault();
    if (submittingRef.current || loading) return;
    if (!apiKey.trim() || !prompt.trim()) return;

    submittingRef.current = true;
    setLoading(true);
    setResult(null);
    setLiveContent("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/v1/ai/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          prompt,
          model,
          complexity,
          stream,
        }),
        signal: controller.signal,
      });

      if (!stream) {
        const data = await res.json();
        if (!res.ok) {
          setResult({
            error: data.error?.message || `Error ${res.status}`,
            requestId: data.error?.requestId || data.requestId,
            model,
            provider: selectedProvider,
          });
        } else {
          const content = data.content ?? "";
          setResult({
            content,
            requestId: data.requestId,
            provider: data.provider,
            model: data.model || model,
            usage: data.usage,
            latencyMs: data.latencyMs,
            streamed: false,
            empty: !content.trim(),
          });
        }
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setResult({
          error: data.error?.message || `Error ${res.status}`,
          requestId: data.error?.requestId,
          model,
          provider: selectedProvider,
        });
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setResult({ error: "No response body", model, provider: selectedProvider });
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";
      let requestId: string | undefined;
      let responseModel: string | undefined = model;
      let responseProvider: string | undefined;
      let usage: PlaygroundResult["usage"];
      let latencyMs: number | undefined;
      let streamError: string | undefined;
      let sawDone = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        buffer = parts.pop() || "";

        for (const line of parts) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const event = JSON.parse(payload) as {
              type?: string;
              content?: string;
              requestId?: string;
              message?: string;
              model?: string;
              provider?: string;
              usage?: {
                credits?: number;
                inputTokens?: number;
                outputTokens?: number;
                totalTokens?: number;
              };
              latencyMs?: number;
            };
            if (event.requestId) requestId = event.requestId;
            if (event.model) responseModel = event.model;
            if (event.provider) responseProvider = event.provider;

            if (event.type === "delta" && event.content) {
              accumulated += event.content;
              setLiveContent(accumulated);
            }
            if (event.type === "done") {
              sawDone = true;
              if (event.content) accumulated = event.content;
              usage = event.usage;
              latencyMs = event.latencyMs;
              setLiveContent(accumulated);
            }
            if (event.type === "error") {
              streamError = event.message || "Stream error";
            }
          } catch {
            // ignore partial JSON
          }
        }
      }

      if (controller.signal.aborted) {
        setResult({
          content: accumulated || undefined,
          requestId,
          model: responseModel,
          provider: responseProvider,
          error: accumulated ? "Generation stopped" : "Cancelled",
          streamed: true,
        });
        return;
      }

      if (streamError) {
        setResult({
          error: streamError,
          requestId,
          model: responseModel,
          provider: responseProvider,
          content: accumulated || undefined,
          streamed: true,
        });
      } else if (!sawDone && !accumulated) {
        setResult({
          error: "Empty response from provider",
          requestId,
          model: responseModel,
          provider: responseProvider,
          streamed: true,
          empty: true,
        });
      } else {
        setResult({
          content: accumulated,
          requestId,
          model: responseModel,
          provider: responseProvider,
          usage,
          latencyMs,
          streamed: true,
          empty: !accumulated.trim(),
        });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setResult({
          error: "Cancelled",
          model,
          provider: selectedProvider,
          streamed: stream,
        });
      } else {
        setResult({
          error: err instanceof Error ? err.message : "Network error",
          model,
          provider: selectedProvider,
        });
      }
    } finally {
      submittingRef.current = false;
      abortRef.current = null;
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void onGenerate();
    }
  }

  const displayContent = liveContent || result?.content;
  const charCount = prompt.length;
  const overLimit = charCount > MAX_PROMPT_CHARS;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Playground</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Professional console for the generate API. Models are enforced by your plan on the
            server. Request history lives in{" "}
            <Link href="/dashboard/usage" className="text-blue-400 hover:underline">
              Usage
            </Link>
            .
          </p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-400">
          <div>
            Selected:{" "}
            <span className="text-zinc-200 font-medium">{providerLabel(selectedProvider)}</span>
            {" · "}
            <span className="font-mono text-zinc-300">{model}</span>
          </div>
          <div className="mt-1 text-zinc-500">
            If the primary provider fails before any tokens, ForgeAI may try a configured fallback.
            Partial streams are never mixed across providers.
          </div>
        </div>
      </div>

      <form onSubmit={onGenerate} className="space-y-4">
        <div>
          <label className="block text-sm text-zinc-400 mb-1">API key</label>
          <input
            type="password"
            required
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="fa_live_..."
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm text-zinc-400 mb-1">Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={loading}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {Object.entries(catalogGroups).map(([provider, models]) => (
                <optgroup key={provider} label={providerLabel(provider)}>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} ({m.id}) · {m.minPlan}+
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="mt-1 text-xs text-zinc-500">
              Server rejects models not allowed on your plan (403 MODEL_NOT_ALLOWED).
            </p>
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1">Complexity</label>
            <select
              value={complexity}
              onChange={(e) => setComplexity(e.target.value as Complexity)}
              disabled={loading}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-white text-sm"
            >
              <option value="basic">Basic (1 credit)</option>
              <option value="standard">Standard (2 credits)</option>
              <option value="advanced">Advanced (5 credits)</option>
            </select>
            <p className="mt-1 text-xs text-zinc-500">This request: ~{creditHint} credit(s)</p>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm text-zinc-400">Prompt</label>
            <div className="flex items-center gap-3 text-xs">
              <span className={overLimit ? "text-red-400" : "text-zinc-500"}>
                {charCount.toLocaleString()} / {MAX_PROMPT_CHARS.toLocaleString()}
              </span>
              <button
                type="button"
                onClick={() => setPrompt("")}
                disabled={loading || !prompt}
                className="text-zinc-400 hover:text-white disabled:opacity-40"
              >
                Clear
              </button>
            </div>
          </div>
          <textarea
            required
            rows={8}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={loading}
            placeholder="Write a prompt… (Ctrl/Cmd+Enter to run)"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
          />
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={stream}
              onChange={(e) => setStream(e.target.checked)}
              disabled={loading}
              className="rounded border-zinc-600"
            />
            Stream response (SSE)
          </label>

          <div className="flex gap-2 ml-auto">
            {loading && (
              <button
                type="button"
                onClick={stopGeneration}
                className="rounded-lg border border-zinc-600 px-4 py-2.5 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
              >
                Stop
              </button>
            )}
            <button
              type="submit"
              disabled={loading || overLimit || !prompt.trim() || !apiKey.trim()}
              className="rounded-lg bg-blue-600 px-5 py-2.5 font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {loading ? (stream ? "Streaming…" : "Generating…") : "Generate"}
            </button>
          </div>
        </div>
      </form>

      {(loading || displayContent || result?.error || result?.empty) && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-3">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>Response</span>
            {loading && <span className="text-blue-400">In progress…</span>}
          </div>

          {result?.error ? (
            <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-red-300 text-sm">
              {result.error}
            </div>
          ) : null}

          {result?.empty && !result.error ? (
            <div className="text-zinc-500 text-sm italic">Empty response (no text content).</div>
          ) : null}

          {displayContent ? (
            <pre className="whitespace-pre-wrap text-sm text-zinc-200 min-h-[4rem]">
              {displayContent}
              {loading && stream && (
                <span className="inline-block w-1.5 h-4 ml-0.5 bg-blue-400 animate-pulse align-middle" />
              )}
            </pre>
          ) : loading ? (
            <div className="text-zinc-500 text-sm">Waiting for first token…</div>
          ) : null}

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 border-t border-zinc-800 pt-3">
            {result?.requestId && (
              <span>
                Request ID: <span className="font-mono text-zinc-400">{result.requestId}</span>
              </span>
            )}
            {(result?.provider || selectedProvider) && (
              <span>Provider: {providerLabel(result?.provider || selectedProvider)}</span>
            )}
            {(result?.model || model) && (
              <span className="font-mono">Model: {result?.model || model}</span>
            )}
            {result?.latencyMs != null && <span>Latency: {result.latencyMs}ms</span>}
            {result?.usage?.credits != null && <span>Credits: {result.usage.credits}</span>}
            {result?.usage?.inputTokens != null && (
              <span>In tokens: {result.usage.inputTokens}</span>
            )}
            {result?.usage?.outputTokens != null && (
              <span>Out tokens: {result.usage.outputTokens}</span>
            )}
            {result?.streamed != null && (
              <span>{result.streamed ? "Mode: stream" : "Mode: json"}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
