import Image from "next/image";
import Link from "next/link";
import LoginClient from "./LoginClient";

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const callbackUrlRaw = typeof params?.callbackUrl === "string" ? params.callbackUrl : "";
  const callbackUrl = callbackUrlRaw.startsWith("/") ? callbackUrlRaw : "/dashboard";

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50 lg:h-screen lg:overflow-hidden">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-4 lg:h-full lg:grid-cols-[1.05fr_1fr] lg:items-center lg:px-6 lg:py-5">
        <section className="relative hidden overflow-hidden rounded-3xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/15 via-emerald-400/5 to-transparent p-6 lg:block">
          <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-emerald-300/20 blur-2xl" />
          <div className="pointer-events-none absolute -left-10 -bottom-10 h-40 w-40 rounded-full bg-emerald-500/15 blur-2xl" />
          <div className="relative grid h-full grid-cols-[1fr_260px] gap-6">
            <div className="flex h-full flex-col justify-between">
              <div>
                <p className="inline-flex items-center rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-200">
                  CribMatch Access
                </p>
                <h1 className="mt-4 h-[5.5rem] max-w-[16ch] text-3xl font-semibold tracking-tight text-white xl:text-4xl">
                  Love where you live, faster.
                </h1>
                <p className="mt-3 h-[3.25rem] max-w-[38ch] text-sm leading-relaxed text-slate-200">
                  Discover verified homes, friendly support, and stress-free next steps in one place.
                </p>
                <ul className="mt-4 h-[4.75rem] space-y-1.5 text-sm text-slate-200/90">
                  <li>• Verified listings and trusted contacts</li>
                  <li>• WhatsApp-first help from search to viewing</li>
                  <li>• Smart filters for budget and lifestyle</li>
                </ul>
              </div>
              <p className="mt-4 text-xs text-slate-300">
                New here? Browse first on the{" "}
                <Link href="/renters" className="font-medium text-emerald-300 transition hover:text-emerald-200">
                  renters page
                </Link>{" "}
                or explore{" "}
                <Link
                  href="/how-it-works"
                  className="font-medium text-emerald-300 transition hover:text-emerald-200"
                >
                  how it works
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
                className="h-full w-full object-contain object-bottom drop-shadow-[0_18px_32px_rgba(16,185,129,0.35)]"
                priority
              />
            </div>
          </div>
        </section>

        <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-5 shadow-2xl shadow-slate-950/40 lg:p-6">
          <h2 className="text-balance text-xl font-semibold tracking-tight text-white lg:text-2xl">
            Welcome back
          </h2>
          <p className="mt-1 text-sm text-slate-300">
            Sign in with your phone number to continue.
          </p>
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
