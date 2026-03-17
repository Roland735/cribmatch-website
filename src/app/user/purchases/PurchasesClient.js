"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";

export default function PurchasesClient() {
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadPurchases = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await fetch("/api/purchases", {
        method: "GET",
        headers: { "content-type": "application/json" },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load purchases");
      }
      setPurchases(Array.isArray(payload?.purchases) ? payload.purchases : []);
    } catch (err) {
      console.error("Load Purchases Error:", err);
      setError(err?.message || "Failed to load purchases");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPurchases();
  }, [loadPurchases]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-slate-400">Loading your purchases…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-3xl border border-rose-400/20 bg-rose-400/10 p-10 text-center">
        <p className="text-sm font-medium text-rose-200">{error}</p>
        <button
          onClick={loadPurchases}
          className="mt-4 text-sm font-semibold text-emerald-400 hover:text-emerald-300"
        >
          Try again
        </button>
      </div>
    );
  }

  if (purchases.length === 0) {
    return (
      <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-10 text-center">
        <p className="text-sm text-slate-300">No purchases yet.</p>
        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/listings"
              className="inline-flex items-center justify-center rounded-full bg-emerald-400 px-6 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300"
            >
              Browse listings
            </Link>
            <Link
              href="/user/listings?create=true"
              className="inline-flex items-center justify-center rounded-full border border-white/15 bg-white/0 px-6 py-3 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5"
            >
              List a property
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {purchases.map((purchase) => {
        const listing = purchase.listing || {};
        const coverImage = listing.images?.[0] || "";
        
        return (
          <Link
            key={purchase._id}
            href={`/listings/${listing.shortId || listing._id || "#"}`}
            className="block overflow-hidden rounded-3xl border border-white/10 bg-slate-900/40 transition hover:border-white/20 hover:bg-slate-900/60"
          >
            <div className="flex flex-col sm:flex-row sm:items-center p-4 gap-4">
              <div className="relative h-24 w-full sm:w-32 shrink-0 overflow-hidden rounded-2xl bg-slate-950">
                {coverImage ? (
                  <Image
                    src={coverImage.startsWith("http") ? coverImage : `https://${coverImage}`}
                    alt={listing.title || "Listing"}
                    fill
                    className="object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
                    No image
                  </div>
                )}
              </div>
              
              <div className="flex-1 min-w-0">
                <h3 className="truncate text-base font-semibold text-white">
                  {listing.title || "Untitled property"}
                </h3>
                <p className="mt-1 text-sm text-slate-400">
                  {listing.suburb || "Unknown location"} • {listing.bedrooms || "0"} bed • ${listing.pricePerMonth || "0"}/mo
                </p>
                <p className="mt-2 text-[10px] uppercase tracking-wider text-slate-500">
                  Purchased on {new Date(purchase.createdAt).toLocaleDateString()}
                </p>
              </div>
              
              <div className="flex items-center justify-end sm:px-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-400/10 text-emerald-400 transition group-hover:bg-emerald-400/20">
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.5}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </span>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
