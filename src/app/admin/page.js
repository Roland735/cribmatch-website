import AdminClient from "./AdminClient";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import Link from "next/link";

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session?.user?.role !== "admin") redirect("/dashboard");

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-balance text-3xl font-semibold tracking-tight text-white">
        Admin dashboard
      </h1>
      <p className="mt-2 text-sm text-slate-300">Create listings, review activity, and manage pricing.</p>
      <div className="mt-4">
        <Link
          href="/admin/contacts"
          className="inline-flex items-center justify-center rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5"
        >
          View contacts
        </Link>
        <Link
          href="/admin/agents"
          className="ml-2 inline-flex items-center justify-center rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5"
        >
          Agent verification queue
        </Link>
      </div>
      <AdminClient />
    </div>
  );
}
