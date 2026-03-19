import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import AdminClient from "../admin/AdminClient";
import { getPricingSettings } from "@/lib/db";

export default async function Landlords() {
  const session = await getServerSession(authOptions);
  const pricing = await getPricingSettings({ ensurePersisted: true });
  const landlordListingPriceUsd = Number(pricing?.landlordListingPriceUsd || 0);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-16 lg:px-8">
        {!session?.user ? (
          <>
            <div className="mx-auto max-w-2xl text-center">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                For landlords & agents
              </div>
              <h1 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                Fill vacancies faster with less back-and-forth
              </h1>
              <p className="mt-4 text-pretty text-base leading-relaxed text-slate-300 sm:text-lg">
                CribMatch connects your property to serious renters, publishes
                on the web, and coordinates communication on WhatsApp.
              </p>
            </div>

            <div className="mx-auto mt-12 grid max-w-5xl gap-6 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6">
                <h2 className="text-base font-semibold text-white">
                  Simple listing process
                </h2>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  Send photos, rent, suburb, and key features on WhatsApp. We
                  format the listing and share it with matching renters.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6">
                <h2 className="text-base font-semibold text-white">
                  Qualified enquiries
                </h2>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  We filter by budget, suburb, and requirements before
                  connecting you, reducing wasted viewings.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6">
                <h2 className="text-base font-semibold text-white">
                  Agent-friendly workflow
                </h2>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  Keep your process. CribMatch routes enquiries, coordinates
                  viewing slots, and supports follow-ups.
                </p>
              </div>
            </div>

            <div className="mx-auto mt-12 grid max-w-5xl gap-6 lg:grid-cols-2">
              <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  What to send
                </p>
                <ul className="mt-4 space-y-2 text-sm text-slate-300">
                  <li className="flex gap-2">
                    <span className="text-emerald-300">•</span>
                    Suburb + rent + deposit
                  </li>
                  <li className="flex gap-2">
                    <span className="text-emerald-300">•</span>
                    Bedrooms + bathrooms + furnished/unfurnished
                  </li>
                  <li className="flex gap-2">
                    <span className="text-emerald-300">•</span>
                    Borehole/solar/security details
                  </li>
                  <li className="flex gap-2">
                    <span className="text-emerald-300">•</span>
                    Photos + location pin + viewing availability
                  </li>
                </ul>
              </div>
              <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-6 flex flex-col justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-emerald-200">
                    Get started
                  </p>
                  <p className="mt-3 text-sm leading-6 text-emerald-100/90">
                    Sign in to list directly on the web or continue on WhatsApp.
                  </p>
                  <p className="mt-3 text-xs text-emerald-100/80">
                    Current listing fee: {landlordListingPriceUsd === 0 ? "Free" : `$${landlordListingPriceUsd.toFixed(2)} per listing`}.
                  </p>
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link
                    href="/login"
                    className="inline-flex rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300"
                  >
                    Sign in to list property
                  </Link>
                  <a
                    href="https://wa.me/263771150713"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex rounded-full border border-emerald-400/30 bg-emerald-400/0 px-5 py-2.5 text-sm font-semibold text-emerald-200 transition hover:border-emerald-400/50 hover:bg-emerald-400/5"
                  >
                    Chat on WhatsApp
                  </a>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="mx-auto max-w-4xl">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <Link
                  href="/user"
                  className="text-sm font-medium text-emerald-400 transition hover:text-emerald-300"
                >
                  ← Back to dashboard
                </Link>
                <h1 className="mt-2 text-3xl font-semibold text-white">Landlord portal</h1>
              </div>
            </div>
            <AdminClient scope="mine" showSignOut={false} />
          </div>
        )}
      </div>
    </div>
  );
}
