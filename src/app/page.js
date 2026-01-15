export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50">
      <header className="border-b border-white/10">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 lg:px-8">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-400/10 ring-1 ring-emerald-400/50">
              <span className="text-sm font-semibold text-emerald-300">
                CM
              </span>
            </div>
            <span className="text-lg font-semibold tracking-tight">
              CribMatch
            </span>
          </div>
          <div className="hidden items-center gap-8 text-sm text-slate-300 md:flex">
            <a href="#features" className="transition hover:text-white">
              Features
            </a>
            <a href="#how-it-works" className="transition hover:text-white">
              How it works
            </a>
            <a href="#faq" className="transition hover:text-white">
              FAQ
            </a>
          </div>
          <div className="flex items-center gap-3">
            <button className="hidden rounded-full border border-white/20 px-4 py-1.5 text-sm font-medium text-slate-100 transition hover:border-white/40 hover:bg-white/5 md:inline-flex">
              Log in
            </button>
            <button className="rounded-full bg-emerald-400 px-4 py-1.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300">
              Get early access
            </button>
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-20 pt-10 lg:px-8 lg:pb-28 lg:pt-16">
        <section className="grid gap-12 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-center">
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
              Smart housing matches for students and young professionals
            </div>
            <div className="space-y-4">
              <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
                Find a place that feels like home, before you move in.
              </h1>
              <p className="max-w-xl text-pretty text-base leading-relaxed text-slate-300 sm:text-lg">
                CribMatch pairs you with compatible roommates and vetted
                apartments near your campus or office. Skip endless scrolling
                and awkward tours and move into a place that fits how you live.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <button className="rounded-full bg-emerald-400 px-6 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/25 transition hover:bg-emerald-300">
                Start your match quiz
              </button>
              <button className="rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-slate-50 transition hover:border-white/40 hover:bg-white/5">
                Browse sample listings
              </button>
              <span className="text-xs text-slate-400">
                No credit card needed. Get matches in under 5 minutes.
              </span>
            </div>
            <dl className="grid gap-6 text-sm text-slate-300 sm:grid-cols-3">
              <div className="space-y-1 rounded-2xl border border-white/5 bg-white/5 px-4 py-3">
                <dt className="text-xs uppercase tracking-wide text-slate-400">
                  Verified listings
                </dt>
                <dd className="text-lg font-semibold text-white">12k+</dd>
              </div>
              <div className="space-y-1 rounded-2xl border border-white/5 bg-white/5 px-4 py-3">
                <dt className="text-xs uppercase tracking-wide text-slate-400">
                  Match accuracy
                </dt>
                <dd className="text-lg font-semibold text-white">92%</dd>
              </div>
              <div className="space-y-1 rounded-2xl border border-white/5 bg-white/5 px-4 py-3">
                <dt className="text-xs uppercase tracking-wide text-slate-400">
                  Avg. time to match
                </dt>
                <dd className="text-lg font-semibold text-white">3 days</dd>
              </div>
            </dl>
          </div>

          <div className="space-y-6 rounded-3xl border border-white/10 bg-gradient-to-b from-slate-900/60 to-slate-950/80 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.85)]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Match preview
                </p>
                <p className="mt-1 text-sm text-slate-200">
                  Based on your lifestyle and budget.
                </p>
              </div>
              <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-200">
                Sample
              </span>
            </div>
            <div className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/80 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-white">
                    Bright 2-bedroom near Downtown Campus
                  </p>
                  <p className="text-xs text-slate-400">
                    7 min walk • Fully furnished • In-unit laundry
                  </p>
                </div>
                <p className="text-sm font-semibold text-emerald-300">
                  $1,150
                  <span className="ml-1 text-xs text-slate-400">/month</span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-slate-800 px-3 py-1 text-slate-200">
                  Quiet weekday nights
                </span>
                <span className="rounded-full bg-slate-800 px-3 py-1 text-slate-200">
                  Non-smoking
                </span>
                <span className="rounded-full bg-slate-800 px-3 py-1 text-slate-200">
                  Pet friendly
                </span>
              </div>
              <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-900/70 p-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    Roommate compatibility
                  </p>
                  <p className="text-sm font-semibold text-white">High match</p>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-300">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-200">
                    93%
                  </div>
                  <p className="max-w-[10rem] text-[11px] text-slate-400">
                    Similar schedule, shared interests, aligned cleanliness
                    preferences.
                  </p>
                </div>
              </div>
            </div>
            <p className="text-xs text-slate-400">
              Real matches include verified landlord details, safety checks, and
              neighborhood fit insights.
            </p>
          </div>
        </section>

        <section
          id="features"
          className="mt-20 space-y-8 border-t border-white/10 pt-12"
        >
          <div className="space-y-3">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Designed for how real people find housing today.
            </h2>
            <p className="max-w-2xl text-sm text-slate-300 sm:text-base">
              CribMatch blends verified housing data with lifestyle signals so
              you are not just renting a room, you are choosing your next
              chapter.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-900/60 p-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-400/15 text-sm font-semibold text-emerald-200">
                1
              </div>
              <h3 className="text-sm font-semibold text-white sm:text-base">
                Smart roommate matching
              </h3>
              <p className="text-xs text-slate-300 sm:text-sm">
                Share how you live, your schedule, and what matters to you.
                CribMatch scores compatibility so you meet people you will feel
                comfortable sharing a home with.
              </p>
            </div>
            <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-900/60 p-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-400/15 text-sm font-semibold text-emerald-200">
                2
              </div>
              <h3 className="text-sm font-semibold text-white sm:text-base">
                Vetted listings only
              </h3>
              <p className="text-xs text-slate-300 sm:text-sm">
                Every home is reviewed for safety, accuracy, and neighborhood
                fit. No more bait-and-switch photos or missing details.
              </p>
            </div>
            <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-900/60 p-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-400/15 text-sm font-semibold text-emerald-200">
                3
              </div>
              <h3 className="text-sm font-semibold text-white sm:text-base">
                Guided move-in
              </h3>
              <p className="text-xs text-slate-300 sm:text-sm">
                From scheduling tours to signing, CribMatch guides you every
                step with simple checklists and reminders.
              </p>
            </div>
          </div>
        </section>

        <section
          id="how-it-works"
          className="mt-20 grid gap-10 border-t border-white/10 pt-12 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]"
        >
          <div className="space-y-4">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              How CribMatch works
            </h2>
            <p className="max-w-xl text-sm text-slate-300 sm:text-base">
              In a few minutes, you go from overwhelmed listings to a shortlist
              of homes that feel right for you.
            </p>
            <ol className="mt-4 space-y-4 text-sm text-slate-200">
              <li className="flex gap-3">
                <span className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-400/20 text-xs font-semibold text-emerald-200">
                  1
                </span>
                <div>
                  <p className="font-semibold">Tell us how you live</p>
                  <p className="text-xs text-slate-300 sm:text-sm">
                    Take a short quiz covering your routine, budget, ideal
                    commute, and roommate preferences.
                  </p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-400/20 text-xs font-semibold text-emerald-200">
                  2
                </span>
                <div>
                  <p className="font-semibold">Review curated matches</p>
                  <p className="text-xs text-slate-300 sm:text-sm">
                    Get a ranked list of homes and roommates with clear scores
                    and tradeoffs, not endless pages of search results.
                  </p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-400/20 text-xs font-semibold text-emerald-200">
                  3
                </span>
                <div>
                  <p className="font-semibold">Tour, decide, move in</p>
                  <p className="text-xs text-slate-300 sm:text-sm">
                    Chat with potential roommates, schedule tours, and complete
                    your move-in checklist in one place.
                  </p>
                </div>
              </li>
            </ol>
          </div>
          <div className="space-y-4 rounded-3xl border border-emerald-400/30 bg-gradient-to-b from-emerald-400/10 to-emerald-400/5 p-6">
            <p className="text-xs font-medium uppercase tracking-wide text-emerald-200">
              Early access waiting list
            </p>
            <p className="text-sm text-slate-50 sm:text-base">
              CribMatch is launching in select university cities and urban hubs.
              Join the waitlist to be among the first to get curated housing
              matches in your area.
            </p>
            <form className="mt-2 space-y-3 text-sm">
              <div className="space-y-1.5">
                <label
                  htmlFor="email"
                  className="block text-xs font-medium text-slate-100"
                >
                  School or city email
                </label>
                <input
                  id="email"
                  type="email"
                  placeholder="you@university.edu"
                  className="block w-full rounded-xl border border-white/20 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none ring-0 transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40"
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="city"
                  className="block text-xs font-medium text-slate-100"
                >
                  City or campus
                </label>
                <input
                  id="city"
                  type="text"
                  placeholder="Downtown Campus, Boston"
                  className="block w-full rounded-xl border border-white/20 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none ring-0 transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40"
                />
              </div>
              <button className="mt-2 w-full rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-md shadow-emerald-400/30 transition hover:bg-emerald-300">
                Join the waitlist
              </button>
              <p className="text-[11px] text-emerald-100/80">
                By joining, you agree to receive occasional emails about
                CribMatch. You can unsubscribe anytime.
              </p>
            </form>
          </div>
        </section>

        <section
          id="faq"
          className="mt-20 space-y-8 border-t border-white/10 pt-12"
        >
          <div className="space-y-3">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Questions, answered.
            </h2>
            <p className="max-w-2xl text-sm text-slate-300 sm:text-base">
              Here is what people ask us before joining CribMatch.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2 rounded-2xl border border-white/10 bg-slate-900/60 p-5">
              <h3 className="text-sm font-semibold text-white sm:text-base">
                Is CribMatch free to use?
              </h3>
              <p className="text-xs text-slate-300 sm:text-sm">
                During early access, CribMatch is free for renters. In the
                future, we may offer premium tools for power users, but the core
                matching experience will stay accessible.
              </p>
            </div>
            <div className="space-y-2 rounded-2xl border border-white/10 bg-slate-900/60 p-5">
              <h3 className="text-sm font-semibold text-white sm:text-base">
                Where is CribMatch available?
              </h3>
              <p className="text-xs text-slate-300 sm:text-sm">
                We are starting in major university cities and dense urban hubs.
                Join the waitlist and tell us where you are moving so we can
                prioritize your city.
              </p>
            </div>
            <div className="space-y-2 rounded-2xl border border-white/10 bg-slate-900/60 p-5">
              <h3 className="text-sm font-semibold text-white sm:text-base">
                How do you verify listings and roommates?
              </h3>
              <p className="text-xs text-slate-300 sm:text-sm">
                We combine identity checks, reference signals, and manual
                reviews. Hosts and roommates complete profiles, and we flag
                anything that does not look right before you see it.
              </p>
            </div>
            <div className="space-y-2 rounded-2xl border border-white/10 bg-slate-900/60 p-5">
              <h3 className="text-sm font-semibold text-white sm:text-base">
                Can I list my own place on CribMatch?
              </h3>
              <p className="text-xs text-slate-300 sm:text-sm">
                Yes. If you have a spare room or a full unit, you will be able
                to create a listing, set preferences for roommates, and get
                matched with people who fit your space.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 py-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 text-xs text-slate-500 sm:flex-row lg:px-8">
          <p>© {new Date().getFullYear()} CribMatch. All rights reserved.</p>
          <div className="flex gap-4">
            <a href="#features" className="transition hover:text-slate-300">
              Product
            </a>
            <a href="#how-it-works" className="transition hover:text-slate-300">
              How it works
            </a>
            <a href="#faq" className="transition hover:text-slate-300">
              FAQ
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
