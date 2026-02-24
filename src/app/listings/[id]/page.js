import Image from "next/image";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getListingById } from "@/lib/getListings";
import { authOptions } from "@/lib/auth";
import ListingImageSlider from "../ListingImageSlider";

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

function normalizePhone(raw) {
  if (typeof raw !== "string") return "";
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return "";
  return digits;
}

export async function generateMetadata({ params }) {
  const { id } = await params;
  const listing = await getListingById(id);
  if (!listing) {
    return { title: "Listing not found | CribMatch" };
  }

  const title = `${listing.title} | CribMatch`;
  const description =
    listing.description ||
    `Rental in ${listing.suburb}. ${typeof listing.bedrooms === "number" ? `${listing.bedrooms} bedrooms.` : ""} ${typeof listing.pricePerMonth === "number" ? `${formatPrice(listing.pricePerMonth)}/month.` : ""}`.trim();

  const photos = [
    ...(Array.isArray(listing.images) ? listing.images : []),
    ...(Array.isArray(listing.photos) ? listing.photos : []),
    ...(Array.isArray(listing.photosUrls) ? listing.photosUrls : []),
  ].filter((url) => typeof url === "string" && url.trim() !== "");

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: photos.length ? [photos[0]] : [],
    },
  };
}

export default async function ListingDetail({ params }) {
  const { id } = await params;
  const listing = await getListingById(id);
  if (!listing) notFound();

  const session = await getServerSession(authOptions);
  const viewerName =
    typeof session?.user?.name === "string" ? session.user.name.trim() : "";
  const viewerPhoneNumber =
    typeof session?.user?.phoneNumber === "string" ? session.user.phoneNumber.trim() : "";

  const whatsappDigits = normalizePhone(listing.contactWhatsApp);
  const phoneDigits = normalizePhone(listing.contactPhone);
  const hasWhatsApp = Boolean(whatsappDigits);
  const hasPhone = Boolean(phoneDigits);
  const hasEmail = typeof listing.contactEmail === "string" && listing.contactEmail;

  const requestHeaders = headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host");
  const host = forwardedHost || requestHeaders.get("host") || "";
  const proto = requestHeaders.get("x-forwarded-proto") || "https";
  const origin = host ? `${proto}://${host}` : "";
  const listingUrl = origin ? `${origin}/listings/${listing._id}` : `/listings/${listing._id}`;

  const contactGreeting = listing.contactName ? listing.contactName : "there";
  const viewerFooter =
    viewerName || viewerPhoneNumber
      ? `\n\nFrom: ${viewerName || "CribMatch user"}${viewerPhoneNumber ? ` (${viewerPhoneNumber})` : ""}`
      : "";

  const viewingMessage = `Hi ${contactGreeting},\n\nI'm interested in ${listing.title} (${listing.suburb}). Is it still available? I'd like to book a viewing.\n\nLink: ${listingUrl}${viewerFooter}`;
  const offerPriceLine =
    typeof listing.pricePerMonth === "number" ? `${formatPrice(listing.pricePerMonth)}/month` : "";
  const offerDepositLine =
    typeof listing.deposit === "number" ? `${formatPrice(listing.deposit)} deposit` : "";
  const offerTerms = [offerPriceLine, offerDepositLine].filter(Boolean).join(", ");
  const offerMessage = `Hi ${contactGreeting},\n\nI'd like to proceed with ${listing.title} (${listing.suburb}). ${offerTerms ? `I can do ${offerTerms}.` : "Please share your terms."}\n\nLink: ${listingUrl}${viewerFooter}`;

  const whatsappViewingHref = hasWhatsApp
    ? `https://wa.me/${whatsappDigits}?text=${encodeURIComponent(viewingMessage)}`
    : "";
  const whatsappOfferHref = hasWhatsApp
    ? `https://wa.me/${whatsappDigits}?text=${encodeURIComponent(offerMessage)}`
    : "";
  const emailSubject = `CribMatch: ${listing.title}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Residence",
    name: listing.title,
    description: listing.description || undefined,
    image: Array.isArray(listing.images) ? listing.images : undefined,
    address: {
      "@type": "PostalAddress",
      addressLocality: listing.suburb,
      addressCountry: "ZW",
    },
    offers:
      typeof listing.pricePerMonth === "number"
        ? {
          "@type": "Offer",
          price: listing.pricePerMonth,
          priceCurrency: "USD",
          url: `/listings/${listing._id}`,
        }
        : undefined,
  };

  const photos = [
    ...(Array.isArray(listing.images) ? listing.images : []),
    ...(Array.isArray(listing.photos) ? listing.photos : []),
    ...(Array.isArray(listing.photosUrls) ? listing.photosUrls : []),
  ].filter((url) => typeof url === "string" && url.trim() !== "");

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-12 lg:px-8 lg:py-16">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/listings"
            className="text-sm font-semibold text-slate-200 transition hover:text-white"
          >
            ← Back to listings
          </Link>
          <a
            href="https://wa.me/263777215826"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-slate-50 transition hover:border-white/40 hover:bg-white/5"
          >
            Ask on WhatsApp
          </a>
        </div>

        <div className="mt-8 grid gap-10 lg:grid-cols-2 lg:items-start">
          <ListingImageSlider images={photos} title={listing.title} />

          <div className="space-y-8">
            <div className="space-y-3">
              <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                {listing.title}
              </h1>
              <div className="flex flex-wrap items-center gap-2 text-sm">
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
                {typeof listing.bedrooms === "number" ? (
                  <span className="rounded-full bg-white/5 px-3 py-1 text-slate-200 ring-1 ring-inset ring-white/10">
                    {listing.bedrooms} bed
                  </span>
                ) : null}
                {typeof listing.pricePerMonth === "number" ? (
                  <span className="rounded-full bg-emerald-400/10 px-3 py-1 font-semibold text-emerald-200 ring-1 ring-inset ring-emerald-400/20">
                    {formatPrice(listing.pricePerMonth)}/month
                  </span>
                ) : null}
                {typeof listing.deposit === "number" ? (
                  <span className="rounded-full bg-white/5 px-3 py-1 text-slate-200 ring-1 ring-inset ring-white/10">
                    {formatPrice(listing.deposit)} deposit
                  </span>
                ) : null}
              </div>
              {listing.description ? (
                <p className="text-sm leading-6 text-slate-300 sm:text-base">
                  {listing.description}
                </p>
              ) : null}
            </div>

            {Array.isArray(listing.features) && listing.features.length ? (
              <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Features
                </p>
                <div className="mt-4 flex flex-wrap gap-2 text-sm text-slate-200">
                  {listing.features.slice(0, 12).map((feature) => (
                    <span
                      key={feature}
                      className="rounded-full bg-white/5 px-3 py-1 ring-1 ring-inset ring-white/10"
                    >
                      {feature}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div
              id="contact"
              className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-6"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-200">
                Contact
              </p>

              {session ? (
                <>
                  <p className="mt-3 text-sm text-emerald-100/90">
                    {listing.contactName ? listing.contactName : "Landlord / Agent"}
                  </p>

                  <div className="mt-4 grid gap-3 text-sm">
                    {hasWhatsApp ? (
                      <>
                        <a
                          href={whatsappViewingHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex w-full items-center justify-center rounded-xl bg-emerald-400 px-3 py-2 font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300"
                        >
                          Request viewing
                        </a>
                        <a
                          href={whatsappOfferHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex w-full items-center justify-center rounded-xl border border-emerald-400/30 px-3 py-2 font-semibold text-emerald-100 transition hover:bg-emerald-400/10"
                        >
                          Make an offer
                        </a>
                      </>
                    ) : null}
                    {hasPhone ? (
                      <a
                        href={`tel:${phoneDigits}`}
                        className="inline-flex w-full items-center justify-center rounded-xl border border-emerald-400/30 px-3 py-2 font-semibold text-emerald-100 transition hover:bg-emerald-400/10"
                      >
                        Call
                      </a>
                    ) : null}
                    {hasEmail ? (
                      <a
                        href={`mailto:${listing.contactEmail}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(viewingMessage)}`}
                        className="inline-flex w-full items-center justify-center rounded-xl border border-emerald-400/30 px-3 py-2 font-semibold text-emerald-100 transition hover:bg-emerald-400/10"
                      >
                        Email
                      </a>
                    ) : null}
                    <p className="text-xs text-emerald-100/80">
                      Stay safe: view in person and confirm details before paying.
                    </p>
                  </div>
                </>
              ) : (
                <div className="mt-4 space-y-4">
                  <p className="text-sm text-emerald-100/90">
                    Please login to view contact details for this listing.
                  </p>
                  <Link
                    href={`/login?callbackUrl=/listings/${listing._id}`}
                    className="inline-flex w-full items-center justify-center rounded-xl bg-emerald-400 px-3 py-2 font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300"
                  >
                    Login to view contact
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </div>
  );
}
