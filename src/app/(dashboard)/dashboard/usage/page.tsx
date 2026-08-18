import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function UsagePage() {
  const session = await getServerSession(authOptions);
  const userId = session!.user!.id;
  const events = await prisma.usageEvent.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Usage</h1>
      {events.length === 0 ? (
        <p className="text-sm text-zinc-500">No usage yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/80 text-zinc-500 text-left">
              <tr>
                <th className="px-4 py-2">Time</th>
                <th className="px-4 py-2">Endpoint</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Credits</th>
                <th className="px-4 py-2">Request ID</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-t border-zinc-800">
                  <td className="px-4 py-2 text-zinc-400">{e.createdAt.toISOString().slice(0, 19)}</td>
                  <td className="px-4 py-2 font-mono text-xs">{e.endpoint}</td>
                  <td className="px-4 py-2">{e.statusCode}</td>
                  <td className="px-4 py-2">{e.creditsUsed}</td>
                  <td className="px-4 py-2 font-mono text-xs text-zinc-500">{e.requestId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
