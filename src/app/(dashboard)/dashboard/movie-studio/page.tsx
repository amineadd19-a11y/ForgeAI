"use client";

import { useState } from "react";

const formats = ["Short Film", "Feature Film", "Series Episode", "Trailer"];
const styles = ["Cinematic", "Anime", "Pixar-like 3D", "Dark Thriller", "Documentary", "Sci-Fi"];

export default function MovieStudioPage() {
  const [script, setScript] = useState("");
  const [format, setFormat] = useState("Short Film");
  const [style, setStyle] = useState("Cinematic");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  async function transform() {
    if (!script.trim()) return;
    setLoading(true); setError(""); setResult("");
    try {
      const res = await fetch("/api/movie-studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ script, format, style }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      setResult(data.film || "No result returned.");
    } catch (e) { setError(e instanceof Error ? e.message : "Generation failed"); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="inline-flex rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-xs text-purple-300">AI FILM WORKSTUDIO</div>
        <h1 className="mt-3 text-3xl font-bold text-white">Movie Studio</h1>
        <p className="mt-1 max-w-2xl text-zinc-400">Turn your screenplay into a structured film package with scenes, shots, consistent characters, image prompts, video prompts, sound and editing.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4">
          <div><label className="mb-2 block text-sm font-medium text-zinc-300">Screenplay / scenario</label><textarea value={script} onChange={e => setScript(e.target.value)} rows={18} placeholder="Paste your screenplay, story, dialogue or film idea here..." className="w-full resize-y rounded-xl border border-zinc-700 bg-zinc-950 p-4 text-sm text-white outline-none focus:border-purple-500" /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="mb-1 block text-xs text-zinc-500">Format</label><select value={format} onChange={e => setFormat(e.target.value)} className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white">{formats.map(x => <option key={x}>{x}</option>)}</select></div>
            <div><label className="mb-1 block text-xs text-zinc-500">Visual style</label><select value={style} onChange={e => setStyle(e.target.value)} className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white">{styles.map(x => <option key={x}>{x}</option>)}</select></div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-500">Your signed-in ForgeAI account is used automatically. No API key is needed here.</div>
          <button onClick={transform} disabled={loading || !script.trim()} className="w-full rounded-xl bg-purple-600 px-5 py-3 font-semibold text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-40">{loading ? "🎬 Building your film…" : "🎬 Transform into AI Film"}</button>
          {error && <div className="rounded-lg border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-300">{error}</div>}
        </section>
        <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 min-h-[520px]">
          <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold text-white">Film Package</h2><span className="text-xs text-zinc-500">AI generated</span></div>
          {result ? <pre className="max-h-[760px] overflow-auto whitespace-pre-wrap text-sm leading-6 text-zinc-200">{result}</pre> : <div className="flex h-[440px] items-center justify-center text-center text-zinc-600"><div><div className="text-5xl">🎥</div><p className="mt-3 text-sm">Your story becomes a production blueprint here.</p><p className="mt-2 text-xs">Next: render scenes with connected image/video providers.</p></div></div>}
        </section>
      </div>
    </div>
  );
}
