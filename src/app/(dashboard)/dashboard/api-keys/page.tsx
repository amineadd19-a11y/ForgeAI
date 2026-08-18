"use client";

import { useCallback, useEffect, useState } from "react";

type KeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  isActive: boolean;
  createdAt: string;
};

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/keys");
      const data = await res.json();
      if (res.ok) setKeys(data.keys || []);
      else setError(data.error?.message || "Failed to load keys");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createKey(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNewKey(null);
    const res = await fetch("/api/v1/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name || "Default" }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error?.message || "Create failed");
      return;
    }
    setNewKey(data.key);
    setName("");
    load();
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this API key?")) return;
    const res = await fetch(`/api/v1/keys/${id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-white">API Keys</h1>
        <p className="text-sm text-zinc-400 mt-1">Keys are shown only once at creation.</p>
      </div>
      {newKey && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="text-sm font-medium text-amber-200 mb-2">Copy your key now — it will not be shown again.</p>
          <code className="block break-all text-sm text-white bg-zinc-950 rounded-lg p-3 font-mono">{newKey}</code>
        </div>
      )}
      <form onSubmit={createKey} className="flex flex-wrap gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Key name" className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-white text-sm" />
        <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Create key</button>
      </form>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : keys.length === 0 ? (
        <p className="text-sm text-zinc-500">No API keys yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-zinc-500 text-left">
            <tr><th className="py-2">Name</th><th>Prefix</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className="border-t border-zinc-800">
                <td className="py-2 text-zinc-200">{k.name}</td>
                <td className="font-mono text-xs text-zinc-400">{k.keyPrefix}…</td>
                <td>{k.isActive ? <span className="text-green-400">Active</span> : <span className="text-zinc-500">Revoked</span>}</td>
                <td className="text-right">{k.isActive && <button type="button" onClick={() => revoke(k.id)} className="text-red-400 text-xs">Revoke</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
