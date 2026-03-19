import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import AdminContactsClient from "./AdminContactsClient";

export default async function AdminContactsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard");

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-white">
            Contacts
          </h1>
          <p className="mt-2 text-sm text-slate-300">
            Review platform contacts and update your admin contact number.
          </p>
        </div>
        <Link
          href="/admin"
          className="inline-flex items-center justify-center rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5"
        >
          Back to admin
        </Link>
      </div>
      <AdminContactsClient />
    </div>
  );
}
