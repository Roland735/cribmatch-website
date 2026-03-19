import Image from "next/image";
import Link from "next/link";
import LoginClient from "./LoginClient";

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const callbackUrlRaw = typeof params?.callbackUrl === "string" ? params.callbackUrl : "";
  const callbackUrl = callbackUrlRaw.startsWith("/") ? callbackUrlRaw : "/dashboard";

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,#1f2937,transparent_40%),linear-gradient(180deg,#020617_0%,#0b1220_60%,#020617_100%)] text-slate-50">
      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-4 md:px-6 lg:min-h-screen lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:py-6">
        <section className="relative hidden overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-sm lg:block">
          <div className="pointer-events-none absolute -right-12 -top-10 h-44 w-44 rounded-full bg-emerald-400/20 blur-3xl" />
          <div className="pointer-events-none absolute -left-12 -bottom-10 h-48 w-48 rounded-full bg-cyan-400/10 blur-3xl" />
          <div className="relative grid min-h-[540px] grid-cols-[1fr_240px] gap-6">
            <div className="flex h-full flex-col justify-between">
              <div className="space-y-4">
                <p className="inline-flex items-center rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-100">
                  CribMatch
                </p>
                <h1 className="max-w-[14ch] text-balance text-4xl font-semibold leading-tight tracking-tight text-white xl:text-5xl">
                  Move in with confidence.
                </h1>
                <p className="max-w-[34ch] text-sm leading-relaxed text-slate-200">
                  Verified homes, direct contacts, and clear next steps.
                </p>
                <div className="grid max-w-[36ch] grid-cols-2 gap-2 text-xs text-slate-100">
                  <div className="rounded-xl border border-white/15 bg-white/[0.03] px-3 py-2">Verified listings</div>
                  <div className="rounded-xl border border-white/15 bg-white/[0.03] px-3 py-2">WhatsApp guidance</div>
                  <div className="rounded-xl border border-white/15 bg-white/[0.03] px-3 py-2">Smart filters</div>
                  <div className="rounded-xl border border-white/15 bg-white/[0.03] px-3 py-2">Faster decisions</div>
                </div>
              </div>
              <p className="text-xs text-slate-300">
                New here?{" "}
                <Link href="/renters" className="font-medium text-emerald-300 transition hover:text-emerald-200">
                  Browse rentals
                </Link>{" "}
                or{" "}
                <Link href="/how-it-works" className="font-medium text-emerald-300 transition hover:text-emerald-200">
                  see how it works
                </Link>
                .
              </p>
            </div>
            <div className="flex h-full items-end justify-center">
              <Image
                src="/happy-person.svg"
                alt="Happy renter illustration"
                width={640}
                height={760}
                className="h-full w-full object-contain object-bottom drop-shadow-[0_22px_40px_rgba(16,185,129,0.35)]"
                priority
              />
            </div>
          </div>
        </section>

        <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-[0_20px_60px_rgba(2,6,23,0.55)] backdrop-blur-sm md:p-5 lg:p-6">
          <h2 className="text-balance text-xl font-semibold tracking-tight text-white md:text-2xl">
            Welcome back
          </h2>
          <p className="mt-1 text-sm text-slate-300">Sign in to continue.</p>
          <LoginClient callbackUrl={callbackUrl} />
          <div className="mt-3 text-xs text-slate-400">
            Need help?{" "}
            <Link href="/contact" className="font-medium text-emerald-300 transition hover:text-emerald-200">
              Contact support
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
