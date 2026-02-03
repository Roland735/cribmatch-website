"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

function toSafeString(value) {
  return typeof value === "string" ? value : "";
}

function toSafeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? asNumber : null;
}

function getNeighborhoodLabel(value) {
  const raw = toSafeString(value);
  if (!raw) return "";
  return raw.split(",")[0]?.trim() || raw;
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

const ALLOWED_SORTS = new Set(["newest", "price_asc", "price_desc", "beds_asc", "beds_desc"]);

function toNonNegativeNumber(value, { integer = false } = {}) {
  const number = toSafeNumber(value);
  if (number === null) return null;
  const normalized = integer ? Math.floor(number) : number;
  if (!Number.isFinite(normalized) || normalized < 0) return null;
  return normalized;
}

function normalizeRangeStrings(
  minValue,
  maxValue,
  { integer = false } = {},
) {
  const minNumber = toNonNegativeNumber(minValue, { integer });
  const maxNumber = toNonNegativeNumber(maxValue, { integer });

  if (minNumber !== null && maxNumber !== null && maxNumber < minNumber) {
    return { min: String(maxNumber), max: String(minNumber) };
  }

  return {
    min: minNumber === null ? "" : String(minNumber),
    max: maxNumber === null ? "" : String(maxNumber),
  };
}

function buildQuery({
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
}) {
  const params = new URLSearchParams();

  if (q.trim()) params.set("q", q.trim());
  if (city.trim()) params.set("city", city.trim());
  if (suburb.trim()) params.set("suburb", suburb.trim());
  if (propertyCategory.trim()) params.set("propertyCategory", propertyCategory.trim());
  if (propertyType.trim()) params.set("propertyType", propertyType.trim());
  if (minPrice.trim()) params.set("minPrice", minPrice.trim());
  if (maxPrice.trim()) params.set("maxPrice", maxPrice.trim());
  if (minDeposit.trim()) params.set("minDeposit", minDeposit.trim());
  if (maxDeposit.trim()) params.set("maxDeposit", maxDeposit.trim());
  if (minBeds.trim()) params.set("minBeds", minBeds.trim());
  if (maxBeds.trim()) params.set("maxBeds", maxBeds.trim());
  if (Array.isArray(features) && features.length) {
    params.set("features", features.join(","));
  }
  if (ALLOWED_SORTS.has(sort) && sort !== "newest") params.set("sort", sort);
  if (photos) params.set("photos", "1");

  return params.toString();
}

function formatTitle(value) {
  const raw = toSafeString(value).trim();
  if (!raw) return "";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function SelectField({
  id,
  label,
  value,
  onChange,
  disabled = false,
  helperText = "",
  children,
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-200" htmlFor={id}>
        {label}
      </label>
      <div className="relative mt-2">
        <select
          id={id}
          value={value}
          onChange={onChange}
          disabled={disabled}
          className="block w-full appearance-none rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 pr-10 text-sm text-slate-50 outline-none transition hover:border-white/20 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {children}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400">
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.24 4.5a.75.75 0 0 1-1.08 0l-4.24-4.5a.75.75 0 0 1 .02-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      </div>
      {helperText ? <p className="mt-2 text-xs text-slate-400">{helperText}</p> : null}
    </div>
  );
}

export default function ListingsFilters({
  cities = [],
  suburbsByCity = {},
  propertyCategories = [],
  propertyTypesByCategory = {},
  features = [],
  resultSummary = "",
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const derived = useMemo(() => {
    const sortRaw = toSafeString(searchParams.get("sort")) || "newest";
    return {
      q: toSafeString(searchParams.get("q")),
      city: toSafeString(searchParams.get("city")),
      suburb: toSafeString(searchParams.get("suburb")),
      propertyCategory: toSafeString(searchParams.get("propertyCategory")),
      propertyType: toSafeString(searchParams.get("propertyType")),
      minPrice: toSafeString(searchParams.get("minPrice")),
      maxPrice: toSafeString(searchParams.get("maxPrice")),
      minDeposit: toSafeString(searchParams.get("minDeposit")),
      maxDeposit: toSafeString(searchParams.get("maxDeposit")),
      minBeds: toSafeString(searchParams.get("minBeds")),
      maxBeds: toSafeString(searchParams.get("maxBeds")),
      sort: ALLOWED_SORTS.has(sortRaw) ? sortRaw : "newest",
      photos: searchParams.get("photos") === "1",
      selectedFeatures: parseCsv(searchParams.get("features")),
    };
  }, [searchParams]);

  const [q, setQ] = useState(derived.q);
  const [city, setCity] = useState(derived.city);
  const [suburb, setSuburb] = useState(derived.suburb);
  const [propertyCategory, setPropertyCategory] = useState(derived.propertyCategory);
  const [propertyType, setPropertyType] = useState(derived.propertyType);
  const [minPrice, setMinPrice] = useState(derived.minPrice);
  const [maxPrice, setMaxPrice] = useState(derived.maxPrice);
  const [minDeposit, setMinDeposit] = useState(derived.minDeposit);
  const [maxDeposit, setMaxDeposit] = useState(derived.maxDeposit);
  const [minBeds, setMinBeds] = useState(derived.minBeds);
  const [maxBeds, setMaxBeds] = useState(derived.maxBeds);
  const [sort, setSort] = useState(derived.sort);
  const [photos, setPhotos] = useState(derived.photos);
  const [selectedFeatures, setSelectedFeatures] = useState(derived.selectedFeatures);

  useEffect(() => {
    setQ(derived.q);
    setCity(derived.city);
    setSuburb(derived.suburb);
    setPropertyCategory(derived.propertyCategory);
    setPropertyType(derived.propertyType);
    setMinPrice(derived.minPrice);
    setMaxPrice(derived.maxPrice);
    setMinDeposit(derived.minDeposit);
    setMaxDeposit(derived.maxDeposit);
    setMinBeds(derived.minBeds);
    setMaxBeds(derived.maxBeds);
    setSort(derived.sort);
    setPhotos(derived.photos);
    setSelectedFeatures(derived.selectedFeatures);
  }, [derived]);

  const activeChips = useMemo(() => {
    const chips = [];
    if (q.trim()) chips.push({ key: "q", label: `Search: ${q.trim()}` });
    if (city.trim()) chips.push({ key: "city", label: city.trim() });
    if (suburb.trim()) {
      chips.push({ key: "suburb", label: getNeighborhoodLabel(suburb.trim()) });
    }
    if (propertyCategory.trim()) {
      chips.push({ key: "propertyCategory", label: formatTitle(propertyCategory.trim()) });
    }
    if (propertyType.trim()) {
      chips.push({ key: "propertyType", label: propertyType.trim() });
    }

    const minP = toSafeNumber(minPrice);
    const maxP = toSafeNumber(maxPrice);
    if (minP !== null || maxP !== null) {
      const parts = [];
      if (minP !== null) parts.push(`$${minP}+`);
      if (maxP !== null) parts.push(`≤ $${maxP}`);
      chips.push({ key: "price", label: parts.join(" ") || "Price" });
    }

    const minD = toSafeNumber(minDeposit);
    const maxD = toSafeNumber(maxDeposit);
    if (minD !== null || maxD !== null) {
      const parts = [];
      if (minD !== null) parts.push(`$${minD}+ deposit`);
      if (maxD !== null) parts.push(`≤ $${maxD} deposit`);
      chips.push({ key: "deposit", label: parts.join(" ") || "Deposit" });
    }

    const minB = toSafeNumber(minBeds);
    const maxB = toSafeNumber(maxBeds);
    if (minB !== null || maxB !== null) {
      const parts = [];
      if (minB !== null) parts.push(`${minB}+ bed`);
      if (maxB !== null) parts.push(`≤ ${maxB} bed`);
      chips.push({ key: "beds", label: parts.join(" ") || "Bedrooms" });
    }

    if (photos) chips.push({ key: "photos", label: "With photos" });
    if (Array.isArray(selectedFeatures) && selectedFeatures.length) {
      for (const feature of selectedFeatures.slice(0, 6)) {
        chips.push({ key: `feature:${feature}`, label: feature });
      }
      if (selectedFeatures.length > 6) {
        chips.push({ key: "feature:more", label: `+${selectedFeatures.length - 6} more` });
      }
    }

    if (sort && sort !== "newest") {
      const label =
        sort === "price_asc"
          ? "Price: low → high"
          : sort === "price_desc"
            ? "Price: high → low"
            : sort === "beds_asc"
              ? "Bedrooms: low → high"
              : sort === "beds_desc"
                ? "Bedrooms: high → low"
                : "Sorted";
      chips.push({ key: "sort", label });
    }

    return chips;
  }, [
    city,
    maxBeds,
    maxDeposit,
    maxPrice,
    minBeds,
    minDeposit,
    minPrice,
    photos,
    propertyCategory,
    propertyType,
    q,
    selectedFeatures,
    sort,
    suburb,
  ]);

  const availableSuburbs = useMemo(() => {
    if (!city.trim()) return [];
    const list = suburbsByCity?.[city.trim()];
    return Array.isArray(list) ? list : [];
  }, [city, suburbsByCity]);

  const availablePropertyTypes = useMemo(() => {
    const mapping = propertyTypesByCategory && typeof propertyTypesByCategory === "object"
      ? propertyTypesByCategory
      : {};
    if (propertyCategory.trim()) {
      const list = mapping[propertyCategory.trim()];
      return Array.isArray(list) ? list : [];
    }
    const all = Object.values(mapping).flatMap((value) => (Array.isArray(value) ? value : []));
    return Array.from(new Set(all.map((value) => toSafeString(value).trim()).filter(Boolean))).sort(
      (a, b) => a.localeCompare(b),
    );
  }, [propertyCategory, propertyTypesByCategory]);

  function toggleFeature(feature) {
    setSelectedFeatures((current) => {
      const next = new Set(Array.isArray(current) ? current : []);
      if (next.has(feature)) {
        next.delete(feature);
      } else if (next.size < 12) {
        next.add(feature);
      }
      return Array.from(next);
    });
  }

  function handleSubmit(event) {
    event.preventDefault();

    const { min: minPriceNormalized, max: maxPriceNormalized } = normalizeRangeStrings(
      minPrice,
      maxPrice,
    );
    const { min: minDepositNormalized, max: maxDepositNormalized } = normalizeRangeStrings(
      minDeposit,
      maxDeposit,
    );
    const { min: minBedsNormalized, max: maxBedsNormalized } = normalizeRangeStrings(
      minBeds,
      maxBeds,
      { integer: true },
    );

    const query = buildQuery({
      q,
      city,
      suburb,
      propertyCategory,
      propertyType,
      minPrice: minPriceNormalized,
      maxPrice: maxPriceNormalized,
      minDeposit: minDepositNormalized,
      maxDeposit: maxDepositNormalized,
      minBeds: minBedsNormalized,
      maxBeds: maxBedsNormalized,
      features: selectedFeatures,
      sort: ALLOWED_SORTS.has(sort) ? sort : "newest",
      photos,
    });
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  function handleReset() {
    router.push(pathname);
  }

  return (
    <div className="mx-auto mt-12 max-w-5xl rounded-3xl border border-white/10 bg-slate-900/40 p-6">
      <form className="grid gap-4 lg:grid-cols-12" onSubmit={handleSubmit}>
        <div className="lg:col-span-4">
          <label className="block text-sm font-medium text-slate-200" htmlFor="q">
            Search
          </label>
          <input
            id="q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Suburb, title, feature (e.g. borehole)…"
            className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
          />
        </div>

        <div className="lg:col-span-3">
          <SelectField
            id="city"
            label="City"
            value={city}
            onChange={(e) => {
              setCity(e.target.value);
              setSuburb("");
            }}
          >
            <option value="">All cities</option>
            {cities.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </SelectField>
        </div>

        <div className="lg:col-span-3">
          <SelectField
            id="suburb"
            label="Suburb"
            value={suburb}
            onChange={(e) => setSuburb(e.target.value)}
            disabled={!city.trim()}
            helperText={!city.trim() ? "Select a city to see suburbs." : ""}
          >
            <option value="">{city.trim() ? "All suburbs" : "Select a city first"}</option>
            {availableSuburbs.map((item) => (
              <option key={item} value={item}>
                {getNeighborhoodLabel(item)}
              </option>
            ))}
          </SelectField>
        </div>

        <div className="lg:col-span-2">
          <SelectField
            id="sort"
            label="Sort"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="newest">Newest</option>
            <option value="price_asc">Price: low → high</option>
            <option value="price_desc">Price: high → low</option>
            <option value="beds_asc">Bedrooms: low → high</option>
            <option value="beds_desc">Bedrooms: high → low</option>
          </SelectField>
        </div>

        <div className="flex items-end justify-end gap-3 lg:col-span-12">
          <button
            type="submit"
            className="w-full rounded-xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300 sm:w-auto"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="hidden w-full rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5 sm:inline-flex sm:w-auto sm:items-center sm:justify-center"
          >
            Clear
          </button>
        </div>

        <details className="lg:col-span-12">
          <summary className="cursor-pointer select-none text-sm font-semibold text-slate-200">
            Filters
          </summary>
          <div className="mt-4 grid gap-4 rounded-2xl border border-white/10 bg-slate-950/40 p-4 lg:grid-cols-12">
            {Array.isArray(propertyCategories) && propertyCategories.length ? (
              <div className="lg:col-span-3">
                <SelectField
                  id="propertyCategory"
                  label="Property category"
                  value={propertyCategory}
                  onChange={(e) => {
                    setPropertyCategory(e.target.value);
                    setPropertyType("");
                  }}
                >
                  <option value="">All categories</option>
                  {propertyCategories.map((item) => (
                    <option key={item} value={item}>
                      {formatTitle(item)}
                    </option>
                  ))}
                </SelectField>
              </div>
            ) : null}

            {(Array.isArray(propertyCategories) && propertyCategories.length) ||
              availablePropertyTypes.length ? (
              availablePropertyTypes.length ? (
                <div className="lg:col-span-3">
                  <SelectField
                    id="propertyType"
                    label="Property type"
                    value={propertyType}
                    onChange={(e) => setPropertyType(e.target.value)}
                  >
                    <option value="">All types</option>
                    {availablePropertyTypes.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </SelectField>
                </div>
              ) : (
                <div className="lg:col-span-3">
                  <SelectField
                    id="propertyType"
                    label="Property type"
                    value={propertyType}
                    onChange={(e) => setPropertyType(e.target.value)}
                    disabled
                    helperText={
                      propertyCategory.trim()
                        ? "No property types available for this category."
                        : "Select a category to see property types."
                    }
                  >
                    <option value="">
                      {propertyCategory.trim()
                        ? "No property types available"
                        : "Select a category first"}
                    </option>
                  </SelectField>
                </div>
              )
            ) : null}

            <div className="lg:col-span-3">
              <label className="block text-sm font-medium text-slate-200" htmlFor="minDeposit">
                Min deposit (USD)
              </label>
              <input
                id="minDeposit"
                inputMode="numeric"
                value={minDeposit}
                onChange={(e) => setMinDeposit(e.target.value)}
                placeholder="0"
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>

            <div className="lg:col-span-3">
              <label className="block text-sm font-medium text-slate-200" htmlFor="maxDeposit">
                Max deposit (USD)
              </label>
              <input
                id="maxDeposit"
                inputMode="numeric"
                value={maxDeposit}
                onChange={(e) => setMaxDeposit(e.target.value)}
                placeholder="2000"
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>

            <div className="lg:col-span-3">
              <label className="block text-sm font-medium text-slate-200" htmlFor="minPrice">
                Min price (USD)
              </label>
              <input
                id="minPrice"
                inputMode="numeric"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                placeholder="0"
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>

            <div className="lg:col-span-3">
              <label className="block text-sm font-medium text-slate-200" htmlFor="maxPrice">
                Max price (USD)
              </label>
              <input
                id="maxPrice"
                inputMode="numeric"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                placeholder="2000"
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>

            <div className="lg:col-span-3">
              <label className="block text-sm font-medium text-slate-200" htmlFor="minBeds">
                Min bedrooms
              </label>
              <input
                id="minBeds"
                inputMode="numeric"
                value={minBeds}
                onChange={(e) => setMinBeds(e.target.value)}
                placeholder="0"
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>

            <div className="lg:col-span-3">
              <label className="block text-sm font-medium text-slate-200" htmlFor="maxBeds">
                Max bedrooms
              </label>
              <input
                id="maxBeds"
                inputMode="numeric"
                value={maxBeds}
                onChange={(e) => setMaxBeds(e.target.value)}
                placeholder="6"
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>

            <div className="flex items-center gap-3 lg:col-span-12">
              <input
                id="photos"
                type="checkbox"
                checked={photos}
                onChange={(e) => setPhotos(e.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-slate-950/60 text-emerald-400 focus:ring-emerald-400/30"
              />
              <label className="text-sm text-slate-200" htmlFor="photos">
                Only show listings with photos
              </label>
            </div>

            {Array.isArray(features) && features.length ? (
              <div className="lg:col-span-12">
                <p className="text-sm font-medium text-slate-200">Features</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {features.slice(0, 12).map((feature) => {
                    const active = selectedFeatures.includes(feature);
                    return (
                      <button
                        key={feature}
                        type="button"
                        onClick={() => toggleFeature(feature)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset transition ${active
                          ? "bg-emerald-400/15 text-emerald-200 ring-emerald-400/30 hover:bg-emerald-400/20"
                          : "bg-white/5 text-slate-200 ring-white/10 hover:bg-white/10"
                          }`}
                      >
                        {feature}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </details>

        <div className="lg:col-span-12">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {activeChips.length ? (
                activeChips.map((chip) => (
                  <span
                    key={chip.key}
                    className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-200 ring-1 ring-inset ring-white/10"
                  >
                    {chip.label}
                  </span>
                ))
              ) : (
                <span className="text-xs text-slate-400">
                  Tip: search “borehole”, “solar”, or your suburb.
                </span>
              )}
            </div>
            {resultSummary ? (
              <span className="text-xs font-semibold text-slate-300">
                {resultSummary}
              </span>
            ) : null}
          </div>
        </div>
      </form>
    </div>
  );
}
