"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

function shouldHideChrome(pathname) {
  if (typeof pathname !== "string") return false;
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/agent" ||
    pathname.startsWith("/agent/") ||
    pathname === "/user" ||
    pathname.startsWith("/user/") ||
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/")
  );
}

export default function SiteChrome({ children }) {
  const pathname = usePathname();
  const hideChrome = shouldHideChrome(pathname);

  if (hideChrome) {
    return <>{children}</>;
  }

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/70 backdrop-blur">
        <nav className="mx-auto max-w-screen-2xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between gap-3">
            <Link href="/" className="flex shrink-0 items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-emerald-400/10 ring-1 ring-emerald-400/50">
                <Image
                  src="/logo.png"
                  alt="CribMatch Logo"
                  width={36}
                  height={36}
                  className="h-full w-full object-cover"
                />
              </div>
              <span className="text-lg font-semibold tracking-tight">CribMatch</span>
              <span className="hidden sm:inline-flex rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs font-semibold text-emerald-200 ring-1 ring-inset ring-emerald-400/30">
                Zimbabwe
              </span>
            </Link>

            <div className="hidden flex-1 items-center justify-center gap-1 text-sm text-slate-200 xl:flex">
              <Link
                href="/how-it-works"
                className="rounded-full px-3 py-2 transition hover:bg-white/5 hover:text-white"
              >
                How it works
              </Link>
              <Link
                href="/listings"
                className="rounded-full px-3 py-2 transition hover:bg-white/5 hover:text-white"
              >
                Listings
              </Link>
              <Link
                href="/pricing"
                className="rounded-full px-3 py-2 transition hover:bg-white/5 hover:text-white"
              >
                Pricing
              </Link>
              <Link
                href="/contact"
                className="rounded-full px-3 py-2 transition hover:bg-white/5 hover:text-white"
              >
                Contact
              </Link>
              <Link
                href="/renters"
                className="hidden rounded-full px-3 py-2 transition hover:bg-white/5 hover:text-white 2xl:inline-flex"
              >
                For Renters
              </Link>
              <Link
                href="/landlords"
                className="hidden rounded-full px-3 py-2 transition hover:bg-white/5 hover:text-white 2xl:inline-flex"
              >
                Landlords & Agents
              </Link>
              <Link
                href="/faq"
                className="hidden rounded-full px-3 py-2 transition hover:bg-white/5 hover:text-white 2xl:inline-flex"
              >
                FAQ
              </Link>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Link
                href="/landlords"
                className="hidden rounded-full border border-white/15 bg-white/0 px-4 py-2 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5 2xl:inline-flex"
              >
                List a property
              </Link>

              <Link
                href="/login"
                className="hidden rounded-full border border-white/15 bg-white/0 px-4 py-2 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5 2xl:inline-flex"
              >
                Login
              </Link>

              <Link
                href="/admin"
                className="hidden rounded-full border border-white/15 bg-white/0 px-4 py-2 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5 2xl:inline-flex"
              >
                Admin
              </Link>

              <a
                href="https://wa.me/263777215826"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden rounded-full bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300 md:inline-flex"
              >
                Chat on WhatsApp
              </a>
              <a
                href="https://wa.me/263777215826"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300 md:hidden"
                aria-label="Chat on WhatsApp"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <path
                    d="M8 10.5H16M8 14H13M6 19.5V18.5C6 17.6716 6.67157 17 7.5 17H18C19.1046 17 20 16.1046 20 15V7C20 5.89543 19.1046 5 18 5H6C4.89543 5 4 5.89543 4 7V15C4 16.1046 4.89543 17 6 17H6.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>

              <details id="mobile-menu" className="relative 2xl:hidden">
                <summary className="list-none inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/0 text-slate-50 transition hover:border-white/30 hover:bg-white/5 [&::-webkit-details-marker]:hidden">
                  <span className="sr-only">Open menu</span>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5"
                    aria-hidden="true"
                  >
                    <path
                      d="M4 7H20M4 12H20M4 17H20"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </summary>
                <div className="absolute right-0 mt-3 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-white/10 bg-slate-950/95 shadow-[0_24px_80px_rgba(15,23,42,0.85)] backdrop-blur">
                  <div className="grid gap-1 p-2 text-sm text-slate-200">
                    <Link
                      href="/how-it-works"
                      className="rounded-xl px-3 py-2 transition hover:bg-white/5 hover:text-white"
                    >
                      How it works
                    </Link>
                    <Link
                      href="/listings"
                      className="rounded-xl px-3 py-2 transition hover:bg-white/5 hover:text-white"
                    >
                      Listings
                    </Link>
                    <Link
                      href="/renters"
                      className="rounded-xl px-3 py-2 transition hover:bg-white/5 hover:text-white"
                    >
                      For Renters
                    </Link>
                    <Link
                      href="/landlords"
                      className="rounded-xl px-3 py-2 transition hover:bg-white/5 hover:text-white"
                    >
                      Landlords & Agents
                    </Link>
                    <Link
                      href="/pricing"
                      className="rounded-xl px-3 py-2 transition hover:bg-white/5 hover:text-white"
                    >
                      Pricing
                    </Link>
                    <Link
                      href="/faq"
                      className="rounded-xl px-3 py-2 transition hover:bg-white/5 hover:text-white"
                    >
                      FAQ
                    </Link>
                    <Link
                      href="/contact"
                      className="rounded-xl px-3 py-2 transition hover:bg-white/5 hover:text-white"
                    >
                      Contact
                    </Link>
                  </div>
                  <div className="grid gap-2 border-t border-white/10 p-2">
                    <Link
                      href="/login"
                      className="flex w-full items-center justify-center rounded-xl border border-white/15 px-3 py-2 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5"
                    >
                      Login
                    </Link>
                    <Link
                      href="/admin"
                      className="flex w-full items-center justify-center rounded-xl border border-white/15 px-3 py-2 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5"
                    >
                      Admin
                    </Link>
                    <Link
                      href="/landlords"
                      className="flex w-full items-center justify-center rounded-xl border border-white/15 px-3 py-2 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5"
                    >
                      List a property
                    </Link>
                    <a
                      href="https://wa.me/263777215826"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex w-full items-center justify-center rounded-xl bg-emerald-400 px-3 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300"
                    >
                      Chat on WhatsApp
                    </a>
                  </div>
                </div>
              </details>
            </div>
          </div>
        </nav>
      </header>

      <main>{children}</main>

      <footer className="border-t border-white/10 bg-slate-950">
        <div className="mx-auto max-w-6xl px-6 py-10 lg:px-8">
          <div className="grid gap-8 md:grid-cols-4">
            <div className="space-y-3">
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
              <p className="text-sm text-slate-400">
                A rental middleman connecting landlords, agents, and tenants
                across Zimbabwe through the web and WhatsApp.
              </p>
            </div>

            <div className="space-y-3 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Product
              </p>
              <div className="grid gap-2 text-slate-300">
                <Link href="/listings" className="transition hover:text-white">
                  Listings
                </Link>
                <Link
                  href="/how-it-works"
                  className="transition hover:text-white"
                >
                  How it works
                </Link>
                <Link href="/pricing" className="transition hover:text-white">
                  Pricing
                </Link>
              </div>
            </div>

            <div className="space-y-3 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Guides
              </p>
              <div className="grid gap-2 text-slate-300">
                <Link href="/renters" className="transition hover:text-white">
                  For renters
                </Link>
                <Link href="/landlords" className="transition hover:text-white">
                  For landlords & agents
                </Link>
                <Link href="/faq" className="transition hover:text-white">
                  FAQ
                </Link>
              </div>
            </div>

            <div className="space-y-3 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Contact
              </p>
              <div className="grid gap-2 text-slate-300">
                <a
                  href="https://wa.me/263777215826"
                  className="transition hover:text-white"
                >
                  WhatsApp: +263 777 215 826
                </a>
                <a
                  href="mailto:rolandmungure@cribmatch.org"
                  className="transition hover:text-white"
                >
                  rolandmungure@cribmatch.org
                </a>
                <Link href="/contact" className="transition hover:text-white">
                  Contact page
                </Link>
              </div>
            </div>
          </div>

          <div className="mt-10 flex flex-col gap-2 border-t border-white/10 pt-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <p>© {new Date().getFullYear()} CribMatch Zimbabwe.</p>
            <p>Stay safe: never share banking PINs. Always verify in person.</p>
          </div>
        </div>
      </footer>

      <script
        dangerouslySetInnerHTML={{
          __html: `(function () {
  function getMenu() {
    return document.getElementById("mobile-menu");
  }

  function closeMenu() {
    var menu = getMenu();
    if (menu && menu.open) menu.open = false;
  }

  document.addEventListener(
    "click",
    function (event) {
      var menu = getMenu();
      if (!menu || !menu.open) return;
      var target = event.target;
      if (!(target instanceof Element)) return;
      var link = target.closest("a");
      if (link && menu.contains(link)) closeMenu();
    },
    true
  );

  var originalPushState = history.pushState;
  var originalReplaceState = history.replaceState;

  history.pushState = function () {
    closeMenu();
    return originalPushState.apply(this, arguments);
  };

  history.replaceState = function () {
    closeMenu();
    return originalReplaceState.apply(this, arguments);
  };

  window.addEventListener("popstate", closeMenu);
})();`,
        }}
      />
    </>
  );
}

