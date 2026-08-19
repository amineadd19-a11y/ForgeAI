import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getBalance } from "@/lib/credits";
import { prisma } from "@/lib/db";
import { PLANS, PlanTier } from "@/lib/config";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  const [balance, subscription, recentUsage, keyCount] = await Promise.all([
    getBalance(userId),
    prisma.subscription.findUnique({ where: { userId }, include: { plan: true } }),
    prisma.usageEvent.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.apiKey.count({ where: { userId, isActive: true } }),
  ]);

  const tier = (subscription?.plan?.tier as PlanTier) || "FREE";
  const plan = PLANS[tier];
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const monthUsage = await prisma.usageEvent.aggregate({
    where: { userId, createdAt: { gte: monthStart } },
    _sum: { creditsUsed: true },
    _count: true,
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-zinc-400 text-sm mt-1">Welcome back</p>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"><div className="text-xs uppercase tracking-wide text-zinc-500">Credits</div><div className="mt-1 text-2xl font-bold text-white">{balance}</div></div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"><div className="text-xs uppercase tracking-wide text-zinc-500">Plan</div><div className="mt-1 text-2xl font-bold text-white">{plan.name}</div></div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"><div className="text-xs uppercase tracking-wide text-zinc-500">Requests (month)</div><div className="mt-1 text-2xl font-bold text-white">{monthUsage._count}</div></div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"><div className="text-xs uppercase tracking-wide text-zinc-500">API keys</div><div className="mt-1 text-2xl font-bold text-white">{keyCount}</div></div>
      </div>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <h2 className="font-semibold text-white mb-4">Recent requests</h2>
        {recentUsage.length === 0 ? (
          <p className="text-sm text-zinc-500">No requests yet. <Link href="/dashboard/playground" className="text-blue-400">Try the playground</Link>.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {recentUsage.map((e) => (
              <li key={e.id} className="flex gap-4 text-zinc-400"><span>{e.createdAt.toISOString().slice(0, 19)}</span><span className="font-mono text-xs">{e.endpoint}</span><span>{e.statusCode}</span><span>{e.creditsUsed} credits</span></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
