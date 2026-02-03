export default function Renters() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-16 lg:px-8">
        <div className="mx-auto max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
            For renters
          </div>
          <h1 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Rent smarter and safer
          </h1>
          <p className="mt-4 text-pretty text-base leading-relaxed text-slate-300 sm:text-lg">
            CribMatch connects you to landlords and agents and helps coordinate
            viewings. Here are practical tips for renting in Zimbabwe.
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6">
            <h2 className="text-base font-semibold text-white">
              Viewing checklist
            </h2>
            <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-300">
              <li className="flex gap-2">
                <span className="text-emerald-300">•</span>
                Bring your ID copy.
              </li>
              <li className="flex gap-2">
                <span className="text-emerald-300">•</span>
                Check water pressure and borehole availability.
              </li>
              <li className="flex gap-2">
                <span className="text-emerald-300">•</span>
                Ask about ZESA/power backup (solar/inverter).
              </li>
              <li className="flex gap-2">
                <span className="text-emerald-300">•</span>
                Confirm security fees and levies.
              </li>
              <li className="flex gap-2">
                <span className="text-emerald-300">•</span>
                Test network signal in the rooms.
              </li>
            </ul>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6">
            <h2 className="text-base font-semibold text-white">
              Safety & verification
            </h2>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              We help you verify contacts and listing details where possible,
              and we guide you on safe steps.
            </p>
            <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-100">
              Never pay a deposit before viewing the property physically.
              CribMatch will never ask for banking PINs.
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6">
            <h2 className="text-base font-semibold text-white">Payments</h2>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              Most rentals are quoted in USD. We help clarify payment terms
              (cash vs transfer) and what’s included, upfront.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6">
            <h2 className="text-base font-semibold text-white">
              After moving in
            </h2>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              Need a plumber or electrician? Ask our WhatsApp assistant for
              recommended service providers in your area.
            </p>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 rounded-3xl border border-white/10 bg-slate-900/40 p-6 text-center sm:flex-row sm:text-left">
          <div>
            <p className="text-sm font-semibold text-white">
              Tell us your suburb and budget and we’ll match you.
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Example: “1 bed in Mt Pleasant under $450”.
            </p>
          </div>
          <a
            href="https://wa.me/263777215826"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300"
          >
            Start on WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}
