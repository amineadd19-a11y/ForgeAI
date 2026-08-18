"use client";

import { useState } from "react";

const formats = ["Short Film", "Feature Film", "Series Episode", "Trailer"];
const styles = ["Cinematic", "Anime", "3D Animation", "Dark Thriller", "Documentary", "Sci-Fi"];

type Scene = { sceneNumber?: number; slugline?: string; action?: string; visualContinuity?: string; imagePrompt?: string; videoPrompt?: string };
type Film = { title?: string; logline?: string; scenes?: Scene[]; imagePrompts?: string[]; videoPrompts?: string[] };

export default function MovieStudioPage() {
  const [script, setScript] = useState("");
  const [format, setFormat] = useState("Short Film");
  const [style, setStyle] = useState("Cinematic");
  const [loading, setLoading] = useState(false);
  const [rendering, setRendering] = useState<string | null>(null);
  const [film, setFilm] = useState<Film | null>(null);
  const [media, setMedia] = useState<Record<string, { image?: string; video?: string }>>({});
  const [error, setError] = useState("");

  async function transform() {
    if (!script.trim()) return;
    setLoading(true); setError(""); setFilm(null); setMedia({});
    try {
      const res = await fetch("/api/movie-studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ script, format, style }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      const raw = data.film || "";
      try { setFilm(JSON.parse(raw)); } catch { setFilm({ logline: raw }); }
    } catch (e) { setError(e instanceof Error ? e.message : "Generation failed"); }
    finally { setLoading(false); }
  }

  async function renderScene(index: number, type: "image" | "video") {
    const scene = film?.scenes?.[index];
    const prompt = type === "image" ? (scene?.imagePrompt || film?.imagePrompts?.[index]) : (scene?.videoPrompt || film?.videoPrompts?.[index]);
    if (!prompt) return;
    if (type === "video" && !media[String(index)]?.image) { setError("Generate the scene image first, then generate its video."); return; }
    setRendering(`${index}-${type}`); setError("");
    try {
      const res = await fetch("/api/movie-studio/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, prompt, imageUrl: media[String(index)]?.image }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      setMedia(prev => ({ ...prev, [String(index)]: { ...prev[String(index)], [type]: data.url } }));
    } catch (e) { setError(e instanceof Error ? e.message : "Media generation failed"); }
    finally { setRendering(null); }
  }

  return <div className="space-y-6">
    <div><div className="inline-flex rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-xs text-purple-300">AI FILM WORKSTUDIO</div><h1 className="mt-3 text-3xl font-bold text-white">Movie Studio</h1><p className="mt-1 max-w-3xl text-zinc-400">Turn a screenplay into a production package, then render scenes as images and video. Generation is charged from your ForgeAI credits.</p></div>
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4">
      <textarea value={script} onChange={e => setScript(e.target.value)} rows={14} placeholder="Paste your screenplay, story, dialogue or film idea here..." className="w-full resize-y rounded-xl border border-zinc-700 bg-zinc-950 p-4 text-sm text-white outline-none focus:border-purple-500" />
      <div className="grid gap-3 sm:grid-cols-2"><select value={format} onChange={e => setFormat(e.target.value)} className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white">{formats.map(x => <option key={x}>{x}</option>)}</select><select value={style} onChange={e => setStyle(e.target.value)} className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white">{styles.map(x => <option key={x}>{x}</option>)}</select></div>
      <button onClick={transform} disabled={loading || !script.trim()} className="w-full rounded-xl bg-purple-600 px-5 py-3 font-semibold text-white hover:bg-purple-500 disabled:opacity-40">{loading ? "🎬 Building production package…" : "🎬 Transform into AI Film"}</button>
      {error && <div className="rounded-lg border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-300">{error}</div>}
    </section>
    {film && <section className="space-y-4"><div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5"><h2 className="text-xl font-bold text-white">{film.title || "Film Package"}</h2><p className="mt-2 text-zinc-400">{film.logline}</p></div>{(film.scenes || []).map((scene, i) => { const m = media[String(i)] || {}; return <article key={i} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold text-white">Scene {scene.sceneNumber || i + 1} · {scene.slugline || "Untitled"}</h3><p className="mt-1 text-sm text-zinc-400">{scene.action}</p></div><div className="flex gap-2"><button onClick={() => renderScene(i, "image")} disabled={rendering !== null} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-white hover:bg-zinc-800">{rendering === `${i}-image` ? "Generating…" : "🖼️ Generate Image"}</button><button onClick={() => renderScene(i, "video")} disabled={rendering !== null || !m.image} className="rounded-lg bg-purple-600 px-3 py-2 text-sm text-white hover:bg-purple-500 disabled:opacity-40">{rendering === `${i}-video` ? "Generating…" : "🎥 Generate Video"}</button></div></div>{m.image && <img src={m.image} alt={`Scene ${i + 1}`} className="mt-4 w-full rounded-xl border border-zinc-800" />}{m.video && <video src={m.video} controls className="mt-4 w-full rounded-xl border border-zinc-800" />}</article>; })}</section>}
  </div>;
}
