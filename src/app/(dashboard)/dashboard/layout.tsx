import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

const nav = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/movie-studio", label: "🎬 Movie Studio" },
  { href: "/dashboard/playground", label: "Playground" },
  { href: "/dashboard/api-keys", label: "API Keys" },
  { href: "/dashboard/usage", label: "Usage" },
  { href: "/dashboard/billing", label: "Billing" },
  { href: "/dashboard/settings", label: "Settings" },
  { href: "/docs", label: "Docs" },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-zinc-800 sticky top-0 z-20 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between gap-4">
          <Link href="/" className="text-lg font-bold text-white shrink-0">Forge<span className="text-blue-500">AI</span></Link>
          <nav className="hidden md:flex items-center gap-1 text-sm overflow-x-auto">
            {nav.map((item) => (
              <Link key={item.href} href={item.href} className="rounded-md px-3 py-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 transition">{item.label}</Link>
            ))}
          </nav>
          <div className="text-sm text-zinc-400 truncate max-w-[140px]">{session.user.email}</div>
        </div>
      </header>
      <main className="flex-1 mx-auto max-w-6xl w-full px-4 py-8">{children}</main>
    </div>
  );
}
