import { getPricingSettings } from "@/lib/db";

export default async function Pricing() {
  const pricing = await getPricingSettings({ ensurePersisted: true });
  const landlordUnlockPrice = Number(
    pricing?.landlordContactUnlockPriceUsd ?? pricing?.contactUnlockPriceUsd ?? 0,
  );
  const agentUnlockPrice = Number(
    pricing?.agentContactUnlockPriceUsd ?? pricing?.contactUnlockPriceUsd ?? 0,
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-16 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
            Pricing & packages
          </div>
          <h1 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Clear pricing
          </h1>
          <p className="mt-4 text-pretty text-base leading-relaxed text-slate-300 sm:text-lg">
            Pricing updates sync automatically across web and WhatsApp.
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-4xl gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-white">
                  Landlord listing contact unlock price
                </h2>
                <p className="mt-2 text-sm text-slate-300">
                  Cost to unlock landlord contact details for one listing.
                </p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-semibold text-white">${landlordUnlockPrice.toFixed(2)}</p>
                <p className="text-xs text-slate-400">USD / listing</p>
              </div>
            </div>
            <div className="mt-6 grid gap-2 text-sm text-slate-300">
              <p className="flex items-start gap-2">
                <span className="text-emerald-300">•</span>
                Unlocks phone, WhatsApp, and email details
              </p>
              <p className="flex items-start gap-2">
                <span className="text-emerald-300">•</span>
                One-time payment per listing
              </p>
              <p className="flex items-start gap-2">
                <span className="text-emerald-300">•</span>
                Works on web and WhatsApp
              </p>
            </div>
            <a
              href="https://wa.me/263771150713"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex rounded-full border border-white/20 px-5 py-2.5 text-sm font-semibold text-slate-50 transition hover:border-white/40 hover:bg-white/5"
            >
              List on WhatsApp
            </a>
          </div>

          <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-white">
                  Agent listing contact unlock price
                </h2>
                <p className="mt-2 text-sm text-emerald-100/90">
                  Cost to unlock agent-managed listing contacts.
                </p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-semibold text-white">${agentUnlockPrice.toFixed(2)}</p>
                <p className="text-xs text-emerald-100/80">USD / listing</p>
              </div>
            </div>
            <div className="mt-6 grid gap-2 text-sm text-emerald-100/90">
              <p className="flex items-start gap-2">
                <span className="text-emerald-200">•</span>
                Unlocks phone, WhatsApp, and email details
              </p>
              <p className="flex items-start gap-2">
                <span className="text-emerald-200">•</span>
                One-time payment per listing
              </p>
              <p className="flex items-start gap-2">
                <span className="text-emerald-200">•</span>
                Works across web and WhatsApp flows
              </p>
            </div>
            <a
              href="https://wa.me/263771150713"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300"
            >
              Upgrade via WhatsApp
            </a>
          </div>
        </div>

        <div className="mx-auto mt-12 max-w-4xl rounded-3xl border border-white/10 bg-slate-900/40 p-6">
          <p className="text-sm text-slate-300">
            Need volume plans for many listings? Message us on WhatsApp for custom pricing.
          </p>
        </div>
      </div>
    </div>
  );
}
