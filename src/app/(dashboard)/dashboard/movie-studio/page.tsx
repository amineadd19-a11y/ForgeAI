"use client";

import { useState } from "react";

const formats = ["Short Film", "Feature Film", "Series Episode", "Trailer"];
const styles = ["Cinematic", "Anime", "3D Animation", "Dark Thriller", "Documentary", "Sci-Fi"];

type Scene = {
  sceneNumber?: number;
  slugline?: string;
  action?: string;
  dialogue?: string;
  visualContinuity?: string;
  imagePrompt?: string;
  videoPrompt?: string;
};
type Film = {
  title?: string;
  logline?: string;
  characters?: Array<{ name?: string; description?: string; appearance?: string }>;
  scenes?: Scene[];
  imagePrompts?: string[];
  videoPrompts?: string[];
  soundDesign?: string[];
  editingPlan?: string[];
  productionChecklist?: string[];
};

function friendlyError(data: {
  error?: string;
  code?: string;
  message?: string;
}): string {
  const code = data.code || "";
  const msg = data.error || data.message || "";
  switch (code) {
    case "AI_NOT_CONFIGURED":
      return msg || "Movie Studio AI is not configured on the server. An administrator must set AI_API_KEY in Production.";
    case "UNAUTHORIZED":
      return "You must be signed in to use Movie Studio.";
    case "INSUFFICIENT_CREDITS":
      return msg || "You do not have enough credits for this transformation.";
    case "AI_RATE_LIMITED":
      return msg || "The AI provider is rate-limited. Please wait a moment and try again.";
    case "AI_TIMEOUT":
      return msg || "Generation timed out. Try a shorter screenplay.";
    case "INVALID_SCREENPLAY":
    case "SCREENPLAY_TOO_LONG":
    case "INVALID_JSON":
    case "AI_INVALID_REQUEST":
      return msg || "Invalid screenplay request.";
    case "INVALID_AI_RESPONSE":
      return msg || "The AI returned an invalid film package. No credits were charged.";
    case "MEDIA_PROVIDER_NOT_CONFIGURED":
      return msg || "Image/video rendering is not configured (FAL_KEY missing).";
    case "MEDIA_GENERATION_FAILED":
      return msg || "Media generation failed. No credits were charged for a failed render.";
    default:
      return msg || "Generation failed. No credits were charged.";
  }
}

export default function MovieStudioPage() {
  const [script, setScript] = useState("");
  const [format, setFormat] = useState("Short Film");
  const [style, setStyle] = useState("Cinematic");
  const [loading, setLoading] = useState(false);
  const [rendering, setRendering] = useState<string | null>(null);
  const [film, setFilm] = useState<Film | null>(null);
  const [media, setMedia] = useState<Record<string, { image?: string; video?: string }>>({});
  const [error, setError] = useState("");
  const [usage, setUsage] = useState<{ credits?: number; remaining?: number } | null>(null);

  async function transform() {
    if (!script.trim()) return;
    setLoading(true);
    setError("");
    setFilm(null);
    setMedia({});
    setUsage(null);
    try {
      const res = await fetch("/api/movie-studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script, format, style }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(friendlyError(data));
      }

      let packageData: Film | null = null;
      if (data.film && typeof data.film === "object") {
        packageData = data.film as Film;
      } else if (typeof data.film === "string") {
        try {
          let text = data.film.trim();
          const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
          if (fence) text = fence[1].trim();
          packageData = JSON.parse(text) as Film;
        } catch {
          packageData = { logline: data.film };
        }
      }
      if (!packageData) throw new Error("Empty film package returned.");
      setFilm(packageData);
      setUsage(data.usage || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  }

  async function renderScene(index: number, type: "image" | "video") {
    const scene = film?.scenes?.[index];
    const prompt =
      type === "image"
        ? scene?.imagePrompt || film?.imagePrompts?.[index]
        : scene?.videoPrompt || film?.videoPrompts?.[index];
    if (!prompt) {
      setError("No prompt available for this scene.");
      return;
    }
    if (type === "video" && !media[String(index)]?.image) {
      setError("Generate the scene image first, then generate its video.");
      return;
    }
    setRendering(`${index}-${type}`);
    setError("");
    try {
      const res = await fetch("/api/movie-studio/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          prompt,
          imageUrl: media[String(index)]?.image,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(friendlyError(data));
      setMedia((prev) => ({
        ...prev,
        [String(index)]: { ...prev[String(index)], [type]: data.url },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Media generation failed");
    } finally {
      setRendering(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="inline-flex rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-xs text-purple-300">
          AI FILM WORKSTUDIO
        </div>
        <h1 className="mt-3 text-3xl font-bold text-white">Movie Studio</h1>
        <p className="mt-1 max-w-3xl text-zinc-400">
          Turn a screenplay into a production package, then render scenes as images and video.
          Generation is charged from your ForgeAI credits only after a successful package is produced.
        </p>
      </div>

      <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          rows={14}
          placeholder="Paste your screenplay, story, dialogue or film idea here..."
          className="w-full resize-y rounded-xl border border-zinc-700 bg-zinc-950 p-4 text-sm text-white outline-none focus:border-purple-500"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
          >
            {formats.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <select
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
          >
            {styles.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </div>
        <button
          onClick={transform}
          disabled={loading || !script.trim()}
          className="w-full rounded-xl bg-purple-600 px-5 py-3 font-semibold text-white hover:bg-purple-500 disabled:opacity-40"
        >
          {loading ? "🎬 Building production package…" : "🎬 Transform into AI Film"}
        </button>
        {error && (
          <div className="rounded-lg border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-300">
            {error}
          </div>
        )}
        {usage && (
          <div className="text-xs text-zinc-500">
            Credits used: {usage.credits ?? 0}
            {typeof usage.remaining === "number" ? ` · Remaining: ${usage.remaining}` : ""}
          </div>
        )}
      </section>

      {film && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <h2 className="text-xl font-bold text-white">{film.title || "Film Package"}</h2>
            <p className="mt-2 text-zinc-400">{film.logline}</p>
            {Array.isArray(film.characters) && film.characters.length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold text-zinc-300">Characters</h3>
                <ul className="mt-2 space-y-1 text-sm text-zinc-400">
                  {film.characters.map((c, i) => (
                    <li key={i}>
                      <span className="text-white">{c.name}</span>
                      {c.appearance ? ` — ${c.appearance}` : c.description ? ` — ${c.description}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {(film.scenes || []).map((scene, i) => {
            const m = media[String(i)] || {};
            return (
              <article key={i} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-white">
                      Scene {scene.sceneNumber || i + 1} · {scene.slugline || "Untitled"}
                    </h3>
                    <p className="mt-1 text-sm text-zinc-400">{scene.action}</p>
                    {scene.dialogue && (
                      <p className="mt-1 text-sm italic text-zinc-500">{scene.dialogue}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => renderScene(i, "image")}
                      disabled={rendering !== null}
                      className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-white hover:bg-zinc-800"
                    >
                      {rendering === `${i}-image` ? "Generating…" : "🖼️ Generate Image"}
                    </button>
                    <button
                      onClick={() => renderScene(i, "video")}
                      disabled={rendering !== null || !m.image}
                      className="rounded-lg bg-purple-600 px-3 py-2 text-sm text-white hover:bg-purple-500 disabled:opacity-40"
                    >
                      {rendering === `${i}-video` ? "Generating…" : "🎥 Generate Video"}
                    </button>
                  </div>
                </div>
                {m.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.image}
                    alt={`Scene ${i + 1}`}
                    className="mt-4 w-full rounded-xl border border-zinc-800"
                  />
                )}
                {m.video && (
                  <video
                    src={m.video}
                    controls
                    className="mt-4 w-full rounded-xl border border-zinc-800"
                  />
                )}
              </article>
            );
          })}

          {Array.isArray(film.productionChecklist) && film.productionChecklist.length > 0 && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
              <h3 className="font-semibold text-white">Production checklist</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-400">
                {film.productionChecklist.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
