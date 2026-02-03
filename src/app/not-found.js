import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50">
      <div className="mx-auto max-w-3xl px-6 py-16 lg:px-8">
        <div className="rounded-3xl border border-white/10 bg-slate-900/50 p-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-200/80">
            404
          </p>
          <h1 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Page not found
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-300 sm:text-base">
            The page you’re looking for doesn’t exist or was moved.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300"
            >
              Back home
            </Link>
            <Link
              href="/listings"
              className="inline-flex items-center justify-center rounded-full border border-white/15 bg-white/0 px-5 py-2.5 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5"
            >
              Browse listings
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center rounded-full border border-white/15 bg-white/0 px-5 py-2.5 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5"
            >
              Contact support
            </Link>
          </div>

          <div className="mt-10 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-5">
            <p className="text-sm font-semibold text-emerald-100">
              Need help fast?
            </p>
            <p className="mt-2 text-sm text-emerald-100/90">
              Chat with us on WhatsApp for matching, viewings, and verification.
            </p>
            <a
              href="https://wa.me/263777215826"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center justify-center rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300"
            >
              Chat on WhatsApp
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

