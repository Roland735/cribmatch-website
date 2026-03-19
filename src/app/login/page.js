import Image from "next/image";
import Link from "next/link";
import LoginClient from "./LoginClient";

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const callbackUrlRaw = typeof params?.callbackUrl === "string" ? params.callbackUrl : "";
  const callbackUrl = callbackUrlRaw.startsWith("/") ? callbackUrlRaw : "/dashboard";

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50 lg:h-screen lg:overflow-hidden">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-4 lg:h-full lg:grid-cols-[1.05fr_1fr] lg:items-stretch lg:px-6 lg:py-5">
        <section className="relative hidden overflow-hidden rounded-3xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/15 via-emerald-400/5 to-transparent p-6 lg:block">
          <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-emerald-300/20 blur-2xl" />
          <div className="pointer-events-none absolute -left-10 -bottom-10 h-40 w-40 rounded-full bg-emerald-500/15 blur-2xl" />
          <div className="relative flex h-full flex-col justify-between">
            <p className="inline-flex items-center rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-200">
              CribMatch Access
            </p>
            <h1 className="mt-4 text-balance text-3xl font-semibold tracking-tight text-white xl:text-4xl">
              Welcome home to easier, happier renting.
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-200">
              Join thousands of renters finding spaces they love. Sign in to get trusted listings, friendly support, and confident next steps.
            </p>
            <ul className="mt-4 space-y-1.5 text-sm text-slate-200/90 max-[800px]:hidden">
              <li>• Happy move-ins with verified listings and contacts</li>
              <li>• Friendly WhatsApp-first support from search to viewing</li>
              <li>• Smart filters that match your budget and lifestyle</li>
            </ul>
            <div className="mt-4 flex items-end justify-center xl:justify-start">
              <Image
                src="/happy-person.svg"
                alt="Happy renter illustration"
                width={640}
                height={760}
                className="h-auto w-[180px] object-contain drop-shadow-[0_18px_32px_rgba(16,185,129,0.35)] xl:w-[220px] max-[800px]:hidden"
                priority
              />
            </div>
            <p className="mt-3 text-xs text-slate-300">
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
        </section>

        <div className="flex min-h-0 flex-col rounded-3xl border border-white/10 bg-slate-900/60 p-5 shadow-2xl shadow-slate-950/40 lg:p-6">
          <h2 className="text-balance text-xl font-semibold tracking-tight text-white lg:text-2xl">
            Welcome back
          </h2>
          <p className="mt-1 text-sm text-slate-300">
            Sign in with your phone number to continue.
          </p>
          <div className="min-h-0 flex-1">
            <LoginClient callbackUrl={callbackUrl} />
          </div>
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
