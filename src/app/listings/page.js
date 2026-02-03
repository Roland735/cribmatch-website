import ListingsGridServer from "./ListingsGridServer";
import ListingsFilters from "./ListingsFilters";
import Link from "next/link";
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

function buildQueryString({
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
  page,
}) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (city) params.set("city", city);
  if (suburb) params.set("suburb", suburb);
  if (propertyCategory) params.set("propertyCategory", propertyCategory);
  if (propertyType) params.set("propertyType", propertyType);
  if (minPrice !== null) params.set("minPrice", String(minPrice));
  if (maxPrice !== null) params.set("maxPrice", String(maxPrice));
  if (minDeposit !== null) params.set("minDeposit", String(minDeposit));
  if (maxDeposit !== null) params.set("maxDeposit", String(maxDeposit));
  if (minBeds !== null) params.set("minBeds", String(minBeds));
  if (maxBeds !== null) params.set("maxBeds", String(maxBeds));
  if (Array.isArray(features) && features.length) {
    params.set("features", features.join(","));
  }
  if (sort && sort !== "newest") params.set("sort", sort);
  if (photos) params.set("photos", "1");
  if (page && page > 1) params.set("page", String(page));
  return params.toString();
}

export async function generateMetadata({ searchParams }) {
  const resolvedSearchParams = await Promise.resolve(searchParams);
  const q = toSafeString(resolvedSearchParams?.q).trim();
  const city = toSafeString(resolvedSearchParams?.city).trim();
  const suburb = toSafeString(resolvedSearchParams?.suburb).trim();
  const propertyCategory = toSafeString(resolvedSearchParams?.propertyCategory).trim();
  const propertyType = toSafeString(resolvedSearchParams?.propertyType).trim();

  const baseTitle = "Featured rentals in Zimbabwe";
  const titleParts = [baseTitle];
  if (q) titleParts.unshift(`Search: ${q}`);
  if (city) titleParts.unshift(city);
  if (suburb) titleParts.unshift(suburb);
  if (propertyType) titleParts.unshift(propertyType);
  if (propertyCategory) titleParts.unshift(propertyCategory);

  const title = `${titleParts.join(" | ")} | CribMatch`;
  const description =
    "Search rentals by suburb, price, bedrooms, and features. View photos and contact landlords or agents via CribMatch.";

  return { title, description };
}

export default async function Listings({ searchParams }) {
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
  const page = Math.max(1, Math.floor(toSafeNumber(resolvedSearchParams?.page) ?? 1));

  const { listings, total, perPage: perPageUsed, page: pageUsed } =
    await searchPublishedListings({
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
      page,
      perPage: 24,
    });

  const hasResults = total > 0;
  const pageCount = Math.max(1, Math.ceil(total / perPageUsed));
  const from = hasResults ? (pageUsed - 1) * perPageUsed + 1 : 0;
  const to = hasResults ? Math.min(pageUsed * perPageUsed, total) : 0;
  const resultSummary = hasResults
    ? `Showing ${from}-${to} of ${total}`
    : "0 matches";

  const baseQuery = {
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
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-16 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
            Listings
          </div>
          <h1 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Featured rentals
          </h1>
          <p className="mt-4 text-pretty text-base leading-relaxed text-slate-300 sm:text-lg">
            Browse listings on the web, then contact landlords and agents to
            confirm availability and viewing slots.
          </p>
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

        <ListingsGridServer
          listings={listings}
          emptyTitle="Listings"
          emptyMessage="No matching listings. Try changing your search or filters."
        />

        {pageCount > 1 ? (
          <div className="mx-auto mt-10 flex max-w-5xl flex-wrap items-center justify-between gap-3 rounded-3xl border border-white/10 bg-slate-900/40 p-5">
            <p className="text-sm text-slate-300">
              Page <span className="font-semibold text-white">{pageUsed}</span> of{" "}
              <span className="font-semibold text-white">{pageCount}</span>
            </p>
            <div className="flex items-center gap-2">
              {pageUsed > 1 ? (
                <Link
                  href={`/listings?${buildQueryString({ ...baseQuery, page: pageUsed - 1 })}`}
                  className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5"
                >
                  ← Previous
                </Link>
              ) : (
                <span className="rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-slate-500">
                  ← Previous
                </span>
              )}
              {pageUsed < pageCount ? (
                <Link
                  href={`/listings?${buildQueryString({ ...baseQuery, page: pageUsed + 1 })}`}
                  className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5"
                >
                  Next →
                </Link>
              ) : (
                <span className="rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-slate-500">
                  Next →
                </span>
              )}
            </div>
          </div>
        ) : null}

        <div className="mx-auto mt-12 flex max-w-2xl flex-col items-center gap-4 rounded-3xl border border-white/10 bg-slate-900/40 p-6 text-center sm:flex-row sm:justify-between sm:text-left">
          <div>
            <p className="text-sm font-semibold text-white">
              Want listings in your exact suburb and budget?
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Message us and we’ll connect you to landlords and agents.
            </p>
          </div>
          <a
            href="https://wa.me/263777215826"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300"
          >
            Ask on WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}
