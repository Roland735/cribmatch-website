import Link from "next/link";
import ListingsGridServer from "./listings/ListingsGridServer";
import ListingsFilters from "./listings/ListingsFilters";
import { getListingFacets, searchPublishedListings } from "@/lib/getListings";
import { Suspense } from "react";

function toSafeString(value) {
  return typeof value === "string" ? value : "";
}

function toSafeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? asNumber : null;
}

const ALLOWED_SORTS = new Set(["newest", "price_asc", "price_desc", "beds_asc", "beds_desc"]);

function normalizeRangeNumbers(minValue, maxValue) {
  const min = toSafeNumber(minValue);
  const max = toSafeNumber(maxValue);
  if (min !== null && min < 0) return normalizeRangeNumbers(null, max);
  if (max !== null && max < 0) return normalizeRangeNumbers(min, null);
  if (min !== null && max !== null && max < min) return { min: max, max: min };
  return { min, max };
}

function parseCsv(value) {
  const raw = toSafeString(value);
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export default async function Home({ searchParams }) {
  const facets = await getListingFacets();

  const resolvedSearchParams = await Promise.resolve(searchParams);
  const q = toSafeString(resolvedSearchParams?.q).trim();
  const city = toSafeString(resolvedSearchParams?.city).trim();
  const suburb = toSafeString(resolvedSearchParams?.suburb).trim();
  const propertyCategory = toSafeString(resolvedSearchParams?.propertyCategory).trim();
  const propertyType = toSafeString(resolvedSearchParams?.propertyType).trim();
  const priceRange = normalizeRangeNumbers(resolvedSearchParams?.minPrice, resolvedSearchParams?.maxPrice);
  const depositRange = normalizeRangeNumbers(resolvedSearchParams?.minDeposit, resolvedSearchParams?.maxDeposit);
  const bedsRange = normalizeRangeNumbers(resolvedSearchParams?.minBeds, resolvedSearchParams?.maxBeds);
  const minPrice = priceRange.min;
  const maxPrice = priceRange.max;
  const minDeposit = depositRange.min;
  const maxDeposit = depositRange.max;
  const minBeds = bedsRange.min === null ? null : Math.floor(bedsRange.min);
  const maxBeds = bedsRange.max === null ? null : Math.floor(bedsRange.max);
  const features = parseCsv(resolvedSearchParams?.features);
  const sortCandidate = toSafeString(resolvedSearchParams?.sort).trim() || "newest";
  const sort = ALLOWED_SORTS.has(sortCandidate) ? sortCandidate : "newest";
  const photos = toSafeString(resolvedSearchParams?.photos) === "1";

  const perPage = 6;
  const { listings, total } = await searchPublishedListings({
    q,
    city,
    suburb,
    propertyCategory,
    propertyType,
    minPrice,
    maxPrice,
    minDeposit,
    maxDeposit,
    minBeds,
    maxBeds,
    features,
    sort,
    photos,
    page: 1,
    perPage,
  });

  const hasResults = total > 0;
  const from = hasResults ? 1 : 0;
  const to = hasResults ? Math.min(perPage, total) : 0;
  const resultSummary = hasResults ? `Showing ${from}-${to} of ${total}` : "0 matches";

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50">
      <main className="mx-auto max-w-6xl px-6 pb-20 pt-10 lg:px-8 lg:pb-28 lg:pt-16">
        <section className="grid gap-12 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-center">
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
              A rental middleman for Zimbabwe — powered by the web + WhatsApp
            </div>

            <div className="space-y-4">
              <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
                Find or list rentals — fast, local, on web + WhatsApp.
              </h1>
              <p className="max-w-xl text-pretty text-base leading-relaxed text-slate-300 sm:text-lg">
                CribMatch connects tenants with landlords and agents. Tell us
                your suburb, budget, and bedrooms, and we match you with
                suitable places, coordinate viewings, and keep the process
                simple and safe.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <a
                href="https://wa.me/263777215826"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full bg-emerald-400 px-6 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/25 transition hover:bg-emerald-300"
              >
                Chat on WhatsApp
              </a>
              <Link
                href="/listings"
                className="rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-slate-50 transition hover:border-white/40 hover:bg-white/5"
              >
                Browse sample listings
              </Link>
              <Link
                href="/landlords"
                className="text-sm font-semibold text-slate-200 transition hover:text-white"
              >
                List a property <span aria-hidden="true">→</span>
              </Link>
              <span className="text-xs text-slate-400">
                Browse on the web. Chat on WhatsApp. No long forms.
              </span>
            </div>

            <dl className="grid gap-6 text-sm text-slate-300 sm:grid-cols-3">
              <div className="space-y-1 rounded-2xl border border-white/5 bg-white/5 px-4 py-3">
                <dt className="text-xs uppercase tracking-wide text-slate-400">
                  Fast matching
                </dt>
                <dd className="text-lg font-semibold text-white">
                  In minutes
                </dd>
              </div>
              <div className="space-y-1 rounded-2xl border border-white/5 bg-white/5 px-4 py-3">
                <dt className="text-xs uppercase tracking-wide text-slate-400">
                  Mobile-first
                </dt>
                <dd className="text-lg font-semibold text-white">Web + WhatsApp</dd>
              </div>
              <div className="space-y-1 rounded-2xl border border-white/5 bg-white/5 px-4 py-3">
                <dt className="text-xs uppercase tracking-wide text-slate-400">
                  Trust & safety
                </dt>
                <dd className="text-lg font-semibold text-white">
                  Guided checks
                </dd>
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
                  What you get when you describe your needs.
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
                    2-bed garden flat in Avondale
                  </p>
                  <p className="text-xs text-slate-400">
                    Borehole • Solar backup • Secure complex
                  </p>
                </div>
                <p className="text-sm font-semibold text-emerald-300">
                  $650
                  <span className="ml-1 text-xs text-slate-400">/month</span>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-slate-800 px-3 py-1 text-slate-200">
                  Verified agent
                </span>
                <span className="rounded-full bg-slate-800 px-3 py-1 text-slate-200">
                  Viewing slots
                </span>
                <span className="rounded-full bg-slate-800 px-3 py-1 text-slate-200">
                  Payment terms
                </span>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-900/70 p-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    Next step
                  </p>
                  <p className="text-sm font-semibold text-white">
                    Schedule a viewing
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-300">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-200">
                    3
                  </div>
                  <p className="max-w-[10rem] text-[11px] text-slate-400">
                    Options based on your suburb, budget, and bedrooms.
                  </p>
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-400">
              Browse on the web, then move to WhatsApp for matching, viewings, and verification.
            </p>
          </div>
        </section>

        <section className="mt-20 space-y-8 border-t border-white/10 pt-12">
          <div className="space-y-3">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Built for Zimbabwean rentals.
            </h2>
            <p className="max-w-2xl text-sm text-slate-300 sm:text-base">
              Local suburbs, USD/ZWL realities, agent workflows, and mobile-first
              experiences.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-900/60 p-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-400/15 text-sm font-semibold text-emerald-200">
                1
              </div>
              <h3 className="text-sm font-semibold text-white sm:text-base">
                Web + WhatsApp flow
              </h3>
              <p className="text-xs text-slate-300 sm:text-sm">
                Browse listings on the web, then send your requirements on WhatsApp
                to get matched options back quickly.
              </p>
            </div>
            <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-900/60 p-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-400/15 text-sm font-semibold text-emerald-200">
                2
              </div>
              <h3 className="text-sm font-semibold text-white sm:text-base">
                Middleman support
              </h3>
              <p className="text-xs text-slate-300 sm:text-sm">
                We connect landlords/agents and tenants, coordinate viewings,
                and keep the process moving.
              </p>
            </div>
            <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-900/60 p-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-400/15 text-sm font-semibold text-emerald-200">
                3
              </div>
              <h3 className="text-sm font-semibold text-white sm:text-base">
                Trust & safety
              </h3>
              <p className="text-xs text-slate-300 sm:text-sm">
                Clear guidance on privacy, safe payments, and basic verification
                steps where possible.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/how-it-works"
              className="rounded-full border border-white/20 px-5 py-2 text-sm font-semibold text-slate-50 transition hover:border-white/40 hover:bg-white/5"
            >
              See how it works
            </Link>
            <Link
              href="/pricing"
              className="rounded-full border border-white/20 px-5 py-2 text-sm font-semibold text-slate-50 transition hover:border-white/40 hover:bg-white/5"
            >
              Pricing & packages
            </Link>
            <Link
              href="/contact"
              className="rounded-full border border-white/20 px-5 py-2 text-sm font-semibold text-slate-50 transition hover:border-white/40 hover:bg-white/5"
            >
              Contact
            </Link>
          </div>
        </section>

        <section className="mt-20 space-y-8 border-t border-white/10 pt-12">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-3">
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Featured listings
              </h2>
              <p className="max-w-2xl text-sm text-slate-300 sm:text-base">
                Tap a listing to see details and contact the landlord/agent.
              </p>
            </div>
            <Link
              href="/listings"
              className="inline-flex rounded-full border border-white/20 px-5 py-2 text-sm font-semibold text-slate-50 transition hover:border-white/40 hover:bg-white/5"
            >
              View all listings
            </Link>
          </div>

          <Suspense
            fallback={
              <div className="mx-auto mt-12 max-w-5xl rounded-3xl border border-white/10 bg-slate-900/40 p-6">
                <div className="h-10 w-full rounded-xl bg-slate-950/60" />
              </div>
            }
          >
            <ListingsFilters
              cities={facets.cities}
              suburbsByCity={facets.suburbsByCity}
              propertyCategories={facets.propertyCategories}
              propertyTypesByCategory={facets.propertyTypesByCategory}
              features={facets.features}
              resultSummary={resultSummary}
            />
          </Suspense>

          <ListingsGridServer listings={listings} compact />
        </section>

        <section className="mt-20 grid gap-10 border-t border-white/10 pt-12 lg:grid-cols-2">
          <div className="space-y-4">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Landlords & agents: list in minutes
            </h2>
            <p className="text-sm text-slate-300 sm:text-base">
              Send photos and details on WhatsApp, get web exposure, and receive
              enquiries from serious renters. No complicated portals.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/landlords"
                className="rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300"
              >
                List a property
              </Link>
              <Link
                href="/listings"
                className="rounded-full border border-white/20 px-5 py-2.5 text-sm font-semibold text-slate-50 transition hover:border-white/40 hover:bg-white/5"
              >
                View listings
              </Link>
            </div>
          </div>

          <div className="space-y-4 rounded-3xl border border-white/10 bg-slate-900/60 p-6">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Safety reminder
            </p>
            <p className="text-sm text-slate-200 sm:text-base">
              CribMatch will never ask for banking PINs. Always view properties
              in person and confirm ownership/agent details before paying
              deposits.
            </p>
            <Link
              href="/faq"
              className="inline-flex text-sm font-semibold text-emerald-200 transition hover:text-emerald-100"
            >
              Read FAQ <span aria-hidden="true">→</span>
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
