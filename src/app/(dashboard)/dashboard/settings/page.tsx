import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  return (
    <div className="space-y-6 max-w-xl">
      <h1 className="text-2xl font-bold text-white">Settings</h1>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-3 text-sm">
        <div className="flex justify-between"><span className="text-zinc-500">Email</span><span className="text-zinc-200">{session?.user?.email}</span></div>
        <div className="flex justify-between"><span className="text-zinc-500">Name</span><span className="text-zinc-200">{session?.user?.name || "—"}</span></div>
        <div className="flex justify-between"><span className="text-zinc-500">User ID</span><span className="text-zinc-400 font-mono text-xs">{session?.user?.id}</span></div>
      </div>
    </div>
  );
}
