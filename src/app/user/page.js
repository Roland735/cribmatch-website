import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import AdminClient from "../admin/AdminClient";

export default async function UserDashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session?.user?.role !== "user" && session?.user?.role !== "agent" && session?.user?.role !== "admin") {
    redirect("/login");
  }

  const privilegedHref = session?.user?.role === "admin" ? "/admin" : "/agent";

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-balance text-3xl font-semibold tracking-tight text-white">
        Welcome
      </h1>
      <p className="mt-2 text-sm text-slate-300">
        Browse listings, shortlist what you like, then chat on WhatsApp to get matched.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
          <p className="text-sm font-semibold text-white">Find a place</p>
          <p className="mt-2 text-sm text-slate-300">
            Search by suburb, budget, and bedrooms.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/listings"
              className="inline-flex items-center justify-center rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300"
            >
              Browse listings
            </Link>
            <Link
              href="/how-it-works"
              className="inline-flex items-center justify-center rounded-full border border-white/15 bg-white/0 px-5 py-2.5 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5"
            >
              How it works
            </Link>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
          <p className="text-sm font-semibold text-white">Need help fast?</p>
          <p className="mt-2 text-sm text-slate-300">
            Send your suburb, budget, and bedrooms on WhatsApp.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a
              href="https://wa.me/263777215826"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300"
            >
              Chat on WhatsApp
            </a>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center rounded-full border border-white/15 bg-white/0 px-5 py-2.5 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5"
            >
              Contact
            </Link>
          </div>
        </div>
      </div>

      {session?.user?.role === "agent" || session?.user?.role === "admin" ? (
        <div className="mt-8 rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-6">
          <p className="text-sm font-semibold text-emerald-100">
            You have {session.user.role} access.
          </p>
          <p className="mt-2 text-sm text-emerald-100/90">
            Continue to your dashboard.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href={privilegedHref}
              className="inline-flex items-center justify-center rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300"
            >
              Go to dashboard
            </Link>
          </div>
        </div>
      ) : null}

      <div className="mt-10 rounded-3xl border border-white/10 bg-slate-900/40 p-6">
        <p className="text-sm font-semibold text-white">List a property</p>
        <p className="mt-2 text-sm text-slate-300">
          Create your listing and keep it updated.
        </p>
      </div>

      <AdminClient scope="mine" />
    </div>
  );
}
