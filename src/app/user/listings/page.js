import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import AdminClient from "../../admin/AdminClient";

export default async function UserListingsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <Link
          href="/user"
          className="text-sm font-medium text-emerald-400 transition hover:text-emerald-300"
        >
          ← Back to dashboard
        </Link>
      </div>

      <h1 className="text-balance text-3xl font-semibold tracking-tight text-white">
        Your listings
      </h1>
      <p className="mt-2 text-sm text-slate-300">
        Create, edit, and manage your property listings here.
      </p>

      <AdminClient scope="mine" />
    </div>
  );
}
