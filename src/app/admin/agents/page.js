import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import AdminAgentsQueueClient from "./AdminAgentsQueueClient";

export const runtime = "nodejs";

export default async function AdminAgentsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session?.user?.role !== "admin") redirect("/dashboard");

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-balance text-3xl font-semibold tracking-tight text-white">
          Agent verification queue
        </h1>
        <Link
          href="/admin"
          className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5"
        >
          Back to admin
        </Link>
      </div>
      <p className="mt-2 text-sm text-slate-300">
        Review pending agent applications and capture status change reasons.
      </p>
      <div className="mt-8">
        <AdminAgentsQueueClient />
      </div>
    </div>
  );
}
