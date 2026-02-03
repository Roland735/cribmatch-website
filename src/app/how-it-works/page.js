export default function HowItWorks() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-16 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
            Simple, human-first process
          </div>
          <h1 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            How CribMatch works
          </h1>
          <p className="mt-4 text-pretty text-base leading-relaxed text-slate-300 sm:text-lg">
            CribMatch is the middleman between tenants and landlords/agents. Use
            the website to browse and shortlist, then use WhatsApp for matching,
            availability checks, and viewing coordination.
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-4xl gap-6 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-400/15 text-sm font-semibold text-emerald-200">
              1
            </div>
            <h2 className="mt-4 text-base font-semibold text-white">
              Browse on the web
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Browse sample listings and shortlist what you like. Then share
              links or requirements so we can match you quickly.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-400/15 text-sm font-semibold text-emerald-200">
              2
            </div>
            <h2 className="mt-4 text-base font-semibold text-white">
              Chat on WhatsApp
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Suburb, budget, bedrooms, and any must-haves like borehole, solar,
              or security.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-400/15 text-sm font-semibold text-emerald-200">
              3
            </div>
            <h2 className="mt-4 text-base font-semibold text-white">
              Get matches & view
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              We send matches, coordinate viewings with agents/landlords, and
              guide basic verification steps.
            </p>
          </div>
        </div>

        <div className="mx-auto mt-12 flex max-w-4xl flex-col items-center gap-4 rounded-3xl border border-white/10 bg-slate-900/40 p-6 text-center sm:flex-row sm:justify-between sm:text-left">
          <div>
            <p className="text-sm font-semibold text-white">
              Ready to start your search?
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Browse the website, then message us on WhatsApp to get matched quickly.
            </p>
          </div>
          <a
            href="https://wa.me/263777215826"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300"
          >
            Chat on WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}
