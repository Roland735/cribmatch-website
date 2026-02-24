"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSession } from "next-auth/react";
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

function normalizeListings(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      id: typeof item._id === "string" ? item._id : "",
      title: typeof item.title === "string" ? item.title : "Untitled listing",
      suburb: typeof item.suburb === "string" ? item.suburb : "",
      propertyCategory: typeof item.propertyCategory === "string" ? item.propertyCategory : "",
      propertyType: typeof item.propertyType === "string" ? item.propertyType : "",
      pricePerMonth:
        typeof item.pricePerMonth === "number" ? item.pricePerMonth : null,
      deposit: typeof item.deposit === "number" ? item.deposit : null,
      bedrooms: typeof item.bedrooms === "number" ? item.bedrooms : null,
      description: typeof item.description === "string" ? item.description : "",
      features: Array.isArray(item.features)
        ? item.features.filter((f) => typeof f === "string").slice(0, 6)
        : [],
      images: Array.isArray(item.images || item.photos || item.photosUrls)
        ? (item.images || item.photos || item.photosUrls).filter((url) => typeof url === "string").slice(0, 12)
        : [],
    }));
}

export default function ListingsGrid() {
  const { data: session } = useSession();
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setErrorMessage("");

        const response = await fetch("/api/listings", {
          method: "GET",
          headers: { "content-type": "application/json" },
        });

        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(payload?.error || "Failed to load listings");
        }

        if (!cancelled) {
          setListings(normalizeListings(payload?.listings));
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error?.message || "Failed to load listings");
          setListings([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const hasListings = listings.length > 0;
  const emptyState = useMemo(() => {
    if (loading) return "Loading listings…";
    if (errorMessage) return errorMessage;
    return "No listings yet. Check back soon or ask on WhatsApp.";
  }, [errorMessage, loading]);

  if (!hasListings) {
    return (
      <div className="mx-auto mt-12 max-w-2xl rounded-3xl border border-white/10 bg-slate-900/40 p-8 text-center">
        <p className="text-sm font-semibold text-white">Featured rentals</p>
        <p className="mt-2 text-sm text-slate-300">{emptyState}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-12 grid max-w-2xl grid-cols-1 gap-6 lg:mx-0 lg:max-w-none lg:grid-cols-3">
      {listings.map((listing) => (
        <article
          key={listing.id || listing.title}
          className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 transition hover:border-white/20"
        >
          <ListingCardSlider
            images={listing.images}
            title={listing.title}
            href={`/listings/${listing.id}`}
          />
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
            {listing.title}
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
            {listing.features.map((feature) => (
              <span
                key={feature}
                className="rounded-full bg-white/5 px-3 py-1 ring-1 ring-inset ring-white/10"
              >
                {feature}
              </span>
            ))}
          </div>
          <div className="mt-6">
            {session ? (
              <Link
                href={`/listings/${listing.id}#contact`}
                className="inline-flex w-full items-center justify-center rounded-xl bg-emerald-400 px-3 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300"
              >
                View contact
              </Link>
            ) : (
              <Link
                href="/login"
                className="inline-flex w-full items-center justify-center rounded-xl bg-emerald-400/10 px-3 py-2 text-sm font-semibold text-emerald-200 ring-1 ring-inset ring-emerald-400/30 transition hover:bg-emerald-400/20"
              >
                Login to view contact
              </Link>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
