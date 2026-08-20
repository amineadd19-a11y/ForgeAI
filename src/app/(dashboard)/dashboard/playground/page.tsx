"use client";

import { useState } from "react";

export default function PlaygroundPage() {
  const [prompt, setPrompt] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [complexity, setComplexity] = useState<"basic" | "standard" | "advanced">("standard");
  const [stream, setStream] = useState(true);
  const [loading, setLoading] = useState(false);
  const [liveContent, setLiveContent] = useState("");
  const [result, setResult] = useState<{
    content?: string;
    requestId?: string;
    usage?: { credits: number };
    latencyMs?: number;
    error?: string;
    streamed?: boolean;
  } | null>(null);

  async function onGenerate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    setLiveContent("");

    try {
      const res = await fetch("/api/v1/ai/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({ prompt, complexity, stream }),
      });

      if (!stream) {
        const data = await res.json();
        if (!res.ok) {
          setResult({
            error: data.error?.message || `Error ${res.status}`,
            requestId: data.error?.requestId,
          });
        } else {
          setResult({
            content: data.content,
            requestId: data.requestId,
            usage: data.usage,
            latencyMs: data.latencyMs,
            streamed: false,
          });
        }
        return;
      }

      // Streaming SSE
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setResult({
          error: data.error?.message || `Error ${res.status}`,
          requestId: data.error?.requestId,
        });
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setResult({ error: "No response body" });
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";
      let requestId: string | undefined;
      let usage: { credits: number } | undefined;
      let latencyMs: number | undefined;
      let streamError: string | undefined;

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
              usage?: { credits?: number };
              latencyMs?: number;
            };
            if (event.requestId) requestId = event.requestId;
            if (event.type === "delta" && event.content) {
              accumulated += event.content;
              setLiveContent(accumulated);
            }
            if (event.type === "done") {
              if (event.content) accumulated = event.content;
              usage = { credits: event.usage?.credits ?? 0 };
              latencyMs = event.latencyMs;
              setLiveContent(accumulated);
            }
            if (event.type === "error") {
              streamError = event.message || "Stream error";
            }
          } catch {
            // ignore parse errors for partial lines
          }
        }
      }

      if (streamError) {
        setResult({ error: streamError, requestId, streamed: true });
      } else {
        setResult({
          content: accumulated,
          requestId,
          usage,
          latencyMs,
          streamed: true,
        });
      }
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : "Network error" });
    } finally {
      setLoading(false);
    }
  }

  const displayContent = liveContent || result?.content;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Playground</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Test the generate API with your API key. Enable streaming to watch tokens arrive live.
        </p>
      </div>
      <form onSubmit={onGenerate} className="space-y-4">
        <div>
          <label className="block text-sm text-zinc-400 mb-1">API key</label>
          <input
            type="password"
            required
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="fa_live_..."
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm text-zinc-400 mb-1">Prompt</label>
          <textarea
            required
            rows={5}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <label className="block text-sm text-zinc-400 mb-1">Complexity</label>
            <select
              value={complexity}
              onChange={(e) => setComplexity(e.target.value as "basic" | "standard" | "advanced")}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-white"
            >
              <option value="basic">Basic (1 credit)</option>
              <option value="standard">Standard (2 credits)</option>
              <option value="advanced">Advanced (5 credits)</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300 mt-5 cursor-pointer">
            <input
              type="checkbox"
              checked={stream}
              onChange={(e) => setStream(e.target.checked)}
              className="rounded border-zinc-600"
            />
            Stream response
          </label>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-blue-600 px-5 py-2.5 font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {loading ? (stream ? "Streaming…" : "Generating…") : "Generate"}
        </button>
      </form>

      {(displayContent || result?.error) && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-3">
          {result?.error ? (
            <div className="text-red-400 text-sm">{result.error}</div>
          ) : (
            <pre className="whitespace-pre-wrap text-sm text-zinc-200">
              {displayContent}
              {loading && stream && (
                <span className="inline-block w-1.5 h-4 ml-0.5 bg-blue-400 animate-pulse align-middle" />
              )}
            </pre>
          )}
          <div className="flex flex-wrap gap-4 text-xs text-zinc-500 border-t border-zinc-800 pt-3">
            {result?.requestId && <span>Request ID: {result.requestId}</span>}
            {result?.latencyMs != null && <span>Latency: {result.latencyMs}ms</span>}
            {result?.usage && <span>Credits: {result.usage.credits}</span>}
            {result?.streamed != null && (
              <span>{result.streamed ? "Mode: stream" : "Mode: json"}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
