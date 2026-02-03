import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { dbConnect, Listing } from "@/lib/db";
import AdminClient from "../admin/AdminClient";

export const runtime = "nodejs";

export default async function AgentDashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session?.user?.role !== "agent" && session?.user?.role !== "admin") {
    redirect("/user");
  }

  const phoneNumber =
    typeof session?.user?.phoneNumber === "string" ? session.user.phoneNumber : "";

  let stats = { total: 0, published: 0, draft: 0 };
  if (phoneNumber && process.env.MONGODB_URI) {
    await dbConnect();
    const [total, published, draft] = await Promise.all([
      Listing.countDocuments({ listerPhoneNumber: phoneNumber }),
      Listing.countDocuments({ listerPhoneNumber: phoneNumber, status: "published" }),
      Listing.countDocuments({ listerPhoneNumber: phoneNumber, status: "draft" }),
    ]);
    stats = { total, published, draft };
  }

  const listingsScope = session?.user?.role === "admin" ? "all" : "mine";

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-balance text-3xl font-semibold tracking-tight text-white">
        Agent dashboard
      </h1>
      <p className="mt-2 text-sm text-slate-300">
        Manage your listings and respond to enquiries.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Total listings
          </p>
          <p className="mt-2 text-3xl font-semibold text-white">{stats.total}</p>
        </div>
        <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Published
          </p>
          <p className="mt-2 text-3xl font-semibold text-white">{stats.published}</p>
        </div>
        <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Draft
          </p>
          <p className="mt-2 text-3xl font-semibold text-white">{stats.draft}</p>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        {session?.user?.role === "admin" ? (
          <Link
            href="/admin"
            className="inline-flex items-center justify-center rounded-full border border-white/15 bg-white/0 px-5 py-2.5 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5"
          >
            Listing manager
          </Link>
        ) : null}
        <Link
          href="/listings"
          className="inline-flex items-center justify-center rounded-full border border-white/15 bg-white/0 px-5 py-2.5 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5"
        >
          View listings
        </Link>
        <a
          href="https://wa.me/263777215826"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300"
        >
          Chat on WhatsApp
        </a>
      </div>

      <AdminClient scope={listingsScope} />
    </div>
  );
}
