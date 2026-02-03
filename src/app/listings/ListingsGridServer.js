import Link from "next/link";
import Image from "next/image";

function formatPrice(pricePerMonth) {
  if (typeof pricePerMonth !== "number") return "";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  })
    .format(pricePerMonth)
    .replace("US$", "$");
}

function formatTitle(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export default function ListingsGridServer({
  listings = [],
  compact = false,
  emptyTitle = "Featured rentals",
  emptyMessage = "No listings yet. Check back soon or ask on WhatsApp.",
}) {
  const hasListings = Array.isArray(listings) && listings.length > 0;

  if (!hasListings) {
    return (
      <div className="mx-auto mt-12 max-w-2xl rounded-3xl border border-white/10 bg-slate-900/40 p-8 text-center">
        <p className="text-sm font-semibold text-white">{emptyTitle}</p>
        <p className="mt-2 text-sm text-slate-300">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div
      className={`mx-auto mt-12 grid max-w-2xl grid-cols-1 gap-6 lg:mx-0 lg:max-w-none ${compact ? "lg:grid-cols-3" : "lg:grid-cols-3"}`}
    >
      {listings.map((listing) => (
        <article
          key={listing._id || listing.title}
          className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 transition hover:border-white/20"
        >
          <Link href={`/listings/${listing._id}`} className="block" prefetch={false}>
            {listing.images?.[0] ? (
              <div className="relative aspect-[16/9] overflow-hidden rounded-2xl bg-slate-950/60 ring-1 ring-inset ring-white/10">
                <Image
                  src={listing.images[0]}
                  alt={listing.title}
                  fill
                  sizes="(min-width: 1024px) 33vw, 100vw"
                  className="object-cover"
                />
              </div>
            ) : (
              <div className="flex aspect-[16/9] items-center justify-center rounded-2xl bg-slate-950/60 text-xs text-slate-500 ring-1 ring-inset ring-white/10">
                Property image
              </div>
            )}
          </Link>

          <div className="mt-6 flex flex-wrap items-center gap-2 text-xs">
            {listing.suburb ? (
              <span className="rounded-full bg-white/5 px-3 py-1 text-slate-200 ring-1 ring-inset ring-white/10">
                {listing.suburb}
              </span>
            ) : null}
            {listing.propertyCategory ? (
              <span className="rounded-full bg-white/5 px-3 py-1 text-slate-200 ring-1 ring-inset ring-white/10">
                {formatTitle(listing.propertyCategory)}
              </span>
            ) : null}
            {listing.propertyType ? (
              <span className="rounded-full bg-white/5 px-3 py-1 text-slate-200 ring-1 ring-inset ring-white/10">
                {listing.propertyType}
              </span>
            ) : null}
            {typeof listing.pricePerMonth === "number" ? (
              <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-emerald-200 ring-1 ring-inset ring-emerald-400/20">
                {formatPrice(listing.pricePerMonth)}/mo
              </span>
            ) : null}
            {typeof listing.deposit === "number" ? (
              <span className="rounded-full bg-white/5 px-3 py-1 text-slate-200 ring-1 ring-inset ring-white/10">
                {formatPrice(listing.deposit)} deposit
              </span>
            ) : null}
          </div>

          <h2 className="mt-4 text-base font-semibold text-white">
            <Link
              href={`/listings/${listing._id}`}
              className="hover:underline"
              prefetch={false}
            >
              {listing.title}
            </Link>
          </h2>

          {listing.description ? (
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {listing.description}
            </p>
          ) : (
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Message us on WhatsApp for photos and viewing slots.
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-400">
            {typeof listing.bedrooms === "number" ? (
              <span className="rounded-full bg-white/5 px-3 py-1 ring-1 ring-inset ring-white/10">
                {listing.bedrooms} bed
              </span>
            ) : null}
            {Array.isArray(listing.features)
              ? listing.features.slice(0, 6).map((feature) => (
                <span
                  key={feature}
                  className="rounded-full bg-white/5 px-3 py-1 ring-1 ring-inset ring-white/10"
                >
                  {feature}
                </span>
              ))
              : null}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href={`/listings/${listing._id}`}
              className="inline-flex items-center justify-center rounded-xl border border-white/15 px-3 py-2 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5"
              prefetch={false}
            >
              View details
            </Link>
            <Link
              href={`/listings/${listing._id}#contact`}
              className="inline-flex items-center justify-center rounded-xl bg-emerald-400 px-3 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300"
              prefetch={false}
            >
              View contacts
            </Link>
          </div>
        </article>
      ))}
    </div>
  );
}
