import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import AdminAccountingClient from "./AdminAccountingClient";

export default async function AdminAccountingPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard");

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-white">
            Accounting
          </h1>
          <p className="mt-2 text-sm text-slate-300">
            Track sales, revenue, top-performing listings, and per-listing transaction history.
          </p>
        </div>
        <Link
          href="/admin"
          className="inline-flex items-center justify-center rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5"
        >
          Back to admin
        </Link>
      </div>
      <AdminAccountingClient />
    </div>
  );
}
