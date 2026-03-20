import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import ListingCardSlider from "./ListingCardSlider";

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

function formatSuburbWithCity(suburb, city) {
  const safeSuburb = typeof suburb === "string" ? suburb.trim() : "";
  const safeCity = typeof city === "string" ? city.trim() : "";
  if (!safeSuburb) return "N/A";
  if (!safeCity) return safeSuburb;
  if (safeSuburb.toLowerCase().includes(safeCity.toLowerCase())) return safeSuburb;
  return `${safeSuburb}, ${safeCity}`;
}

export default async function ListingsGridServer({
  listings = [],
  compact = false,
  emptyTitle = "Featured rentals",
  emptyMessage = "No listings yet. Check back soon or ask on WhatsApp.",
}) {
  const session = await getServerSession(authOptions);
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
      className={`mx-auto mt-12 grid max-w-2xl grid-cols-1 gap-6 lg:max-w-none ${compact ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}
    >
      {listings.map((listing) => {
        const listerType = listing?.listerType || listing?.lister_type || "direct_landlord";
        const agentRate =
          typeof listing?.agentRate === "number"
            ? listing.agentRate
            : typeof listing?.agent_rate === "number"
              ? listing.agent_rate
              : null;
        const agentProfileImageUrl =
          typeof listing?.agentProfileImageUrl === "string"
            ? listing.agentProfileImageUrl.trim()
            : typeof listing?.agent_profile_image_url === "string"
              ? listing.agent_profile_image_url.trim()
              : "";
        const photos = [
          ...(Array.isArray(listing.images) ? listing.images : []),
          ...(Array.isArray(listing.photos) ? listing.photos : []),
          ...(Array.isArray(listing.photosUrls) ? listing.photosUrls : []),
        ].filter((url) => typeof url === "string" && url.trim() !== "");
        const summarySuburb = formatSuburbWithCity(listing.suburb, listing.city);
        const summaryBeds =
          typeof listing.bedrooms === "number" ? `${listing.bedrooms} bed(s)` : "N/A";
        const summaryPrice =
          typeof listing.pricePerMonth === "number"
            ? `${formatPrice(listing.pricePerMonth)}${typeof listing.deposit === "number" ? ` (${formatPrice(listing.deposit)} deposit)` : ""}`
            : "N/A";
        const summaryCode =
          typeof listing.shortId === "string" && listing.shortId.trim()
            ? listing.shortId.trim().toUpperCase()
            : "N/A";

        return (
          <article
            key={listing._id?.toString() || listing.title}
            className="flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60 transition hover:border-white/20"
          >
            <ListingCardSlider
              images={photos}
              title={formatTitle(listing.title)}
              href={`/listings/${listing._id}`}
            />

            <div className="flex flex-1 flex-col p-6">
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-wider">
                {listing.suburb && (
                  <span className="rounded-full bg-white/5 px-2.5 py-1 text-slate-300 ring-1 ring-inset ring-white/10">
                    {listing.suburb}
                  </span>
                )}
                {listing.propertyCategory && (
                  <span className="rounded-full bg-white/5 px-2.5 py-1 text-slate-300 ring-1 ring-inset ring-white/10">
                    {formatTitle(listing.propertyCategory)}
                  </span>
                )}
                {typeof listing.pricePerMonth === "number" && (
                  <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-emerald-300 ring-1 ring-inset ring-emerald-400/20">
                    {formatPrice(listing.pricePerMonth)}/mo
                  </span>
                )}
                {listerType === "agent" ? (
                  <span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-amber-200 ring-1 ring-inset ring-amber-400/30">
                    Agent Listing
                  </span>
                ) : (
                  <span className="rounded-full bg-sky-400/10 px-2.5 py-1 text-sky-200 ring-1 ring-inset ring-sky-400/30">
                    Direct Landlord
                  </span>
                )}
              </div>

              <h2 className="mt-4 line-clamp-1 text-base font-semibold text-white">
                <Link
                  href={`/listings/${listing._id}`}
                  className="hover:underline"
                  prefetch={false}
                >
                  {formatTitle(listing.title)}
                </Link>
              </h2>
              {listerType === "agent" && agentProfileImageUrl ? (
                <div className="mt-3 flex items-center gap-2 text-xs text-slate-300">
                  <div
                    className="h-8 w-8 rounded-full border border-white/15 bg-cover bg-center"
                    style={{ backgroundImage: `url("${agentProfileImageUrl}")` }}
                    aria-hidden="true"
                  />
                  <span>Verified agent</span>
                </div>
              ) : null}

              <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-slate-400">
                {listing.description || "Message us on WhatsApp for photos and viewing slots."}
              </p>

              <div className="mt-4 rounded-xl border border-emerald-400/20 bg-slate-950/50 p-3 text-xs text-emerald-100/95">
                <p>🏷️ CODE: {summaryCode}</p>
                <p className="mt-1">📍 Suburb: {summarySuburb}</p>
                <p className="mt-1">🛏️ Bedrooms: {summaryBeds}</p>
                <p className="mt-1">💰 Price: {summaryPrice}</p>
                {listerType === "agent" && agentRate !== null ? (
                  <p className="mt-1">💼 Agent fee: {agentRate}%</p>
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap gap-2 text-[10px] text-slate-500">
                {typeof listing.bedrooms === "number" && (
                  <span>{listing.bedrooms} bed</span>
                )}
                {Array.isArray(listing.features) && listing.features.length > 0 && (
                  <>
                    <span>•</span>
                    <span className="line-clamp-1">
                      {listing.features.slice(0, 3).join(" • ")}
                    </span>
                  </>
                )}
              </div>

              <div className="mt-auto pt-6">
                {session ? (
                  <Link
                    href={`/listings/${listing._id}#contact`}
                    className="inline-flex w-full items-center justify-center rounded-xl bg-emerald-400 px-3 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300"
                    prefetch={false}
                  >
                    View details
                  </Link>
                ) : (
                  <Link
                    href={`/login?callbackUrl=${encodeURIComponent(`/listings/${listing._id}#contact`)}`}
                    className="inline-flex w-full items-center justify-center rounded-xl bg-emerald-400/10 px-3 py-2.5 text-sm font-semibold text-emerald-200 ring-1 ring-inset ring-emerald-400/30 transition hover:bg-emerald-400/20"
                    prefetch={false}
                  >
                    Login to view contact
                  </Link>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
