"use client";

import Image from "next/image";
import { signOut } from "next-auth/react";
import { supabase } from "@/lib/supabase";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function toNumber(value) {
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? asNumber : null;
}

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function sanitizeFilename(value) {
  if (typeof value !== "string") return "photo";
  const cleaned = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
  return cleaned ? cleaned.slice(-100) : "photo";
}

const RESIDENTIAL_TYPES = ["Apartment", "House", "Cottage", "Garden flat", "Townhouse"];

const BOARDING_TYPES = ["Boarding house (university)", "Boarding house", "Student accommodation", "Room"];

const COMMERCIAL_TYPES = ["Office", "Shop", "Retail warehouse", "Warehouse", "Factory", "Workshop"];

const LAND_TYPES = ["Farm", "Stand", "Plot"];

const COMMON_FEATURES = [
  "Borehole",
  "Solar",
  "Inverter",
  "Generator",
  "Solar geyser",
  "Alarm",
  "Electric gate",
  "Walled & gated",
  "Security",
  "Parking",
  "Garden",
  "Pool",
  "Water available",
  "WiFi",
  "Furnished",
  "Loading bay",
  "3-phase power",
  "High foot traffic",
  "Street-facing",
  "Caretaker",
  "Walking distance to campus",
  "Road access",
  "Fenced",
];

export default function AdminClient({ scope = "all", showSignOut = true } = {}) {
  const [listings, setListings] = useState([]);
  const [loadingListings, setLoadingListings] = useState(true);
  const [listingsError, setListingsError] = useState("");

  const [title, setTitle] = useState("");
  const [suburb, setSuburb] = useState("");
  const [propertyCategory, setPropertyCategory] = useState("residential");
  const [propertyType, setPropertyType] = useState(RESIDENTIAL_TYPES[0]);
  const [pricePerMonth, setPricePerMonth] = useState("");
  const [deposit, setDeposit] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [description, setDescription] = useState("");
  const [selectedFeatures, setSelectedFeatures] = useState([]);
  const [customFeature, setCustomFeature] = useState("");
  const [imageUploads, setImageUploads] = useState([]);
  const [status, setStatus] = useState("published");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const uploadTasksRef = useRef(new Map());

  const cleanedImages = useMemo(() => {
    return imageUploads
      .map((item) => (typeof item?.url === "string" ? item.url.trim() : ""))
      .filter((value) => value)
      .slice(0, 12);
  }, [imageUploads]);

  const hasUploadsInProgress = useMemo(() => {
    return imageUploads.some((item) => item?.status === "uploading");
  }, [imageUploads]);

  const coverUploadId = useMemo(() => {
    const cover = imageUploads.find((item) => item?.status === "done" && item.url);
    return cover?.id || "";
  }, [imageUploads]);

  const cleanedFeatures = useMemo(() => {
    return selectedFeatures
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean)
      .slice(0, 12);
  }, [selectedFeatures]);

  const canSubmit = useMemo(() => {
    return (
      title.trim() &&
      suburb.trim() &&
      toNumber(pricePerMonth) !== null &&
      toNumber(bedrooms) !== null &&
      propertyType.trim() &&
      !hasUploadsInProgress &&
      !saving
    );
  }, [bedrooms, hasUploadsInProgress, pricePerMonth, propertyType, saving, suburb, title]);

  const removeUpload = useCallback(
    (id) => {
      const task = uploadTasksRef.current.get(id);
      if (task) {
        task.cancel();
        uploadTasksRef.current.delete(id);
      }
      setImageUploads((current) => {
        const item = current.find((entry) => entry.id === id);
        if (typeof item?.previewUrl === "string" && item.previewUrl.startsWith("blob:")) {
          URL.revokeObjectURL(item.previewUrl);
        }
        return current.filter((entry) => entry.id !== id);
      });
    },
    [setImageUploads],
  );

  const makeCover = useCallback((id) => {
    setImageUploads((current) => {
      const index = current.findIndex((entry) => entry.id === id);
      if (index <= 0) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.unshift(item);
      return next;
    });
  }, []);

  const clearUploads = useCallback(() => {
    uploadTasksRef.current.forEach((task) => task.cancel());
    uploadTasksRef.current.clear();
    setImageUploads((current) => {
      current.forEach((item) => {
        if (typeof item?.previewUrl === "string" && item.previewUrl.startsWith("blob:")) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
      return [];
    });
  }, []);

  const handlePhotoFilesSelected = useCallback(
    (event) => {
      const files = Array.from(event.target.files || []).filter(
        (file) => file && file.type && file.type.startsWith("image/"),
      );
      event.target.value = "";
      if (!files.length) return;

      const remaining = Math.max(0, 12 - imageUploads.length);
      const selected = files.slice(0, remaining);
      if (!selected.length) return;

      const now = Date.now();
      const queued = selected.map((file, index) => ({
        id: randomId(),
        name: typeof file?.name === "string" ? file.name : "photo",
        previewUrl: URL.createObjectURL(file),
        status: "uploading",
        progress: 0,
        url: "",
        createdAt: now + index,
        error: "",
      }));

      setImageUploads((current) => [...current, ...queued]);

      queued.forEach(async (item, index) => {
        const file = selected[index];
        const safeName = sanitizeFilename(file?.name || "photo");
        const path = `${new Date().toISOString().slice(0, 10)}/${item.id}-${safeName}`;

        try {
          // Set progress to something to show it started
          setImageUploads((current) =>
            current.map((entry) => (entry.id === item.id ? { ...entry, progress: 10 } : entry)),
          );

          const { data, error } = await supabase.storage
            .from("listings")
            .upload(path, file, {
              contentType: file?.type || "image/jpeg",
              upsert: true
            });

          if (error) throw error;

          const { data: { publicUrl } } = supabase.storage
            .from("listings")
            .getPublicUrl(path);

          setImageUploads((current) =>
            current.map((entry) =>
              entry.id === item.id
                ? { ...entry, status: "done", progress: 100, url: publicUrl, error: "" }
                : entry,
            ),
          );

          if (typeof item.previewUrl === "string" && item.previewUrl.startsWith("blob:")) {
            URL.revokeObjectURL(item.previewUrl);
          }
        } catch (error) {
          console.error("Upload error:", error);
          setImageUploads((current) =>
            current.map((entry) =>
              entry.id === item.id
                ? {
                  ...entry,
                  status: "error",
                  error: error?.message || "Upload failed",
                }
                : entry,
            ),
          );
        }
      });
    },
    [imageUploads.length],
  );

  const loadListings = useCallback(async () => {
    try {
      setLoadingListings(true);
      setListingsError("");
      const response = await fetch(
        scope === "mine" ? "/api/listings?mine=1" : "/api/listings?all=1",
        {
          method: "GET",
          headers: { "content-type": "application/json" },
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load listings");
      }
      setListings(Array.isArray(payload?.listings) ? payload.listings : []);
    } catch (error) {
      setListingsError(error?.message || "Failed to load listings");
      setListings([]);
    } finally {
      setLoadingListings(false);
    }
  }, [scope]);

  useEffect(() => {
    loadListings();
  }, [loadListings]);

  async function handleCreate(event) {
    event.preventDefault();
    setSaving(true);
    setSaveError("");

    try {
      const response = await fetch("/api/listings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          suburb: suburb.trim(),
          propertyCategory,
          propertyType: propertyType.trim(),
          pricePerMonth: toNumber(pricePerMonth),
          deposit: toNumber(deposit),
          bedrooms: toNumber(bedrooms),
          description: description.trim(),
          features: cleanedFeatures,
          images: cleanedImages,
          status,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to create listing");
      }

      setTitle("");
      setSuburb("");
      setPropertyCategory("residential");
      setPropertyType(RESIDENTIAL_TYPES[0]);
      setPricePerMonth("");
      setDeposit("");
      setBedrooms("");
      setDescription("");
      setSelectedFeatures([]);
      setCustomFeature("");
      clearUploads();
      setStatus("published");

      await loadListings();
    } catch (error) {
      setSaveError(error?.message || "Failed to create listing");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    const response = await fetch(`/api/listings/${id}`, { method: "DELETE" });
    if (response.ok) {
      await loadListings();
    }
  }

  async function handleToggleStatus(listing) {
    const nextStatus = listing.status === "draft" ? "published" : "draft";
    const response = await fetch(`/api/listings/${listing._id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (response.ok) {
      await loadListings();
    }
  }

  return (
    <div className="mt-10 space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-white">Listings</p>
        {showSignOut ? (
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/" })}
            className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5"
          >
            Sign out
          </button>
        ) : null}
      </div>

      <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
        <p className="text-sm font-semibold text-white">Create listing</p>
        <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={handleCreate}>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-slate-200" htmlFor="title">
              Title
            </label>
            <input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              placeholder="Modern 2-bed garden flat"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-200" htmlFor="suburb">
              Suburb
            </label>
            <input
              id="suburb"
              value={suburb}
              onChange={(e) => setSuburb(e.target.value)}
              className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              placeholder="Avondale"
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium text-slate-200"
              htmlFor="propertyCategory"
            >
              Property category
            </label>
            <select
              id="propertyCategory"
              value={propertyCategory}
              onChange={(e) => {
                const nextRaw = e.target.value;
                const next =
                  nextRaw === "commercial" || nextRaw === "boarding" || nextRaw === "land"
                    ? nextRaw
                    : "residential";
                setPropertyCategory(next);
                if (next === "commercial") {
                  setPropertyType(COMMERCIAL_TYPES[0]);
                  setBedrooms("0");
                } else if (next === "land") {
                  setPropertyType(LAND_TYPES[0]);
                  setBedrooms("0");
                } else if (next === "boarding") {
                  setPropertyType(BOARDING_TYPES[0]);
                } else {
                  setPropertyType(RESIDENTIAL_TYPES[0]);
                }
              }}
              className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
            >
              <option value="residential">Residential</option>
              <option value="boarding">Boarding</option>
              <option value="commercial">Commercial</option>
              <option value="land">Land</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-200" htmlFor="propertyType">
              Property type
            </label>
            <select
              id="propertyType"
              value={propertyType}
              onChange={(e) => setPropertyType(e.target.value)}
              className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
            >
              {(propertyCategory === "commercial"
                ? COMMERCIAL_TYPES
                : propertyCategory === "boarding"
                  ? BOARDING_TYPES
                  : propertyCategory === "land"
                    ? LAND_TYPES
                    : RESIDENTIAL_TYPES
              ).map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              className="block text-sm font-medium text-slate-200"
              htmlFor="pricePerMonth"
            >
              Price per month (USD)
            </label>
            <input
              id="pricePerMonth"
              inputMode="numeric"
              value={pricePerMonth}
              onChange={(e) => setPricePerMonth(e.target.value)}
              className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              placeholder="650"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-200" htmlFor="deposit">
              Deposit (USD)
            </label>
            <input
              id="deposit"
              inputMode="numeric"
              value={deposit}
              onChange={(e) => setDeposit(e.target.value)}
              className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              placeholder={propertyCategory === "commercial" ? "5000" : "650"}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-200" htmlFor="bedrooms">
              Bedrooms
            </label>
            <input
              id="bedrooms"
              inputMode="numeric"
              value={bedrooms}
              onChange={(e) => setBedrooms(e.target.value)}
              className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              placeholder={propertyCategory === "commercial" ? "0" : "2"}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-200" htmlFor="status">
              Status
            </label>
            <select
              id="status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
            >
              <option value="published">Published</option>
              <option value="draft">Draft</option>
            </select>
          </div>

          <div className="sm:col-span-2">
            <p className="block text-sm font-medium text-slate-200">Features</p>
            <p className="mt-1 text-xs text-slate-400">Select up to 12.</p>

            <div className="mt-3 flex flex-wrap gap-2">
              {COMMON_FEATURES.map((feature) => {
                const active = cleanedFeatures.includes(feature);
                return (
                  <button
                    key={feature}
                    type="button"
                    onClick={() => {
                      if (active) {
                        setSelectedFeatures((current) =>
                          current.filter((value) => value !== feature),
                        );
                        return;
                      }
                      setSelectedFeatures((current) => {
                        if (current.length >= 12) return current;
                        if (current.includes(feature)) return current;
                        return [...current, feature];
                      });
                    }}
                    className={
                      active
                        ? "rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-200 ring-1 ring-inset ring-emerald-400/30 transition hover:bg-emerald-400/20"
                        : "rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200 ring-1 ring-inset ring-white/10 transition hover:bg-white/10"
                    }
                  >
                    {feature}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                value={customFeature}
                onChange={(e) => setCustomFeature(e.target.value)}
                className="block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
                placeholder="Add a custom feature"
              />
              <button
                type="button"
                onClick={() => {
                  const next = customFeature.trim();
                  if (!next) return;
                  setSelectedFeatures((current) => {
                    if (current.length >= 12) return current;
                    if (current.includes(next)) return current;
                    return [...current, next];
                  });
                  setCustomFeature("");
                }}
                className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5"
                disabled={!customFeature.trim() || cleanedFeatures.length >= 12}
              >
                Add
              </button>
            </div>

            {cleanedFeatures.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {cleanedFeatures.map((feature) => (
                  <button
                    key={feature}
                    type="button"
                    onClick={() =>
                      setSelectedFeatures((current) =>
                        current.filter((value) => value !== feature),
                      )
                    }
                    className="rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200 ring-1 ring-inset ring-white/10 transition hover:bg-white/10"
                  >
                    {feature} <span className="text-slate-400">×</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="sm:col-span-2">
            <p className="block text-sm font-medium text-slate-200">Pictures</p>
            <p className="mt-1 text-xs text-slate-400">
              Upload photos to Firebase (up to 12). The first one is the cover.
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <input
                id="listingPhotos"
                type="file"
                accept="image/*"
                multiple
                onChange={handlePhotoFilesSelected}
                className="hidden"
              />
              <label
                htmlFor="listingPhotos"
                className={`rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5 ${imageUploads.length >= 12 ? "pointer-events-none opacity-60" : ""}`}
              >
                Upload photos
              </label>
              <button
                type="button"
                onClick={clearUploads}
                className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5"
                disabled={!imageUploads.length}
              >
                Clear
              </button>
              <span className="text-xs text-slate-400">
                {cleanedImages.length}/12 uploaded
              </span>
              {hasUploadsInProgress ? (
                <span className="text-xs text-slate-400">Uploading…</span>
              ) : null}
            </div>

            {imageUploads.length ? (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {imageUploads.slice(0, 12).map((item, index) => {
                  const src =
                    item.status === "done" && item.url
                      ? item.url
                      : typeof item.previewUrl === "string"
                        ? item.previewUrl
                        : "";
                  const isCover = coverUploadId ? item.id === coverUploadId : index === 0;
                  return (
                    <div
                      key={item.id}
                      className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-950/60"
                    >
                      {src ? (
                        <Image
                          src={src}
                          alt=""
                          width={320}
                          height={160}
                          className="h-20 w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-20 w-full items-center justify-center text-xs text-slate-500">
                          Photo
                        </div>
                      )}

                      <div className="absolute right-2 top-2 flex gap-2">
                        {!isCover ? (
                          <button
                            type="button"
                            onClick={() => makeCover(item.id)}
                            className="rounded-full border border-white/15 bg-slate-950/60 px-2 py-1 text-[10px] font-semibold text-slate-50 transition hover:border-white/30 hover:bg-slate-950/80"
                            disabled={item.status !== "done"}
                          >
                            Cover
                          </button>
                        ) : (
                          <span className="rounded-full border border-emerald-400/30 bg-emerald-400/15 px-2 py-1 text-[10px] font-semibold text-emerald-200">
                            Cover
                          </span>
                        )}

                        <button
                          type="button"
                          onClick={() => removeUpload(item.id)}
                          className="rounded-full border border-white/15 bg-slate-950/60 px-2 py-1 text-[10px] font-semibold text-slate-50 transition hover:border-white/30 hover:bg-slate-950/80"
                        >
                          Remove
                        </button>
                      </div>

                      {item.status === "uploading" ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 text-xs font-semibold text-slate-50">
                          {typeof item.progress === "number" ? `${item.progress}%` : "Uploading…"}
                        </div>
                      ) : null}

                      {item.status === "error" ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-rose-950/60 px-2 text-center text-[10px] font-semibold text-rose-100">
                          {item.error || "Upload failed"}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>

          <div className="sm:col-span-2">
            <label
              className="block text-sm font-medium text-slate-200"
              htmlFor="description"
            >
              Description
            </label>
            <textarea
              id="description"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              placeholder="Short description for the listing card."
            />
          </div>

          {saveError ? (
            <p className="sm:col-span-2 text-sm font-medium text-rose-200">
              {saveError}
            </p>
          ) : null}

          <div className="sm:col-span-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={loadListings}
              className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5"
              disabled={saving}
            >
              Refresh
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving…" : "Create listing"}
            </button>
          </div>
        </form>
      </div>

      <div className="rounded-3xl border border-white/10 bg-slate-900/40">
        <div className="flex items-center justify-between gap-4 border-b border-white/10 p-5">
          <p className="text-sm font-semibold text-white">
            {scope === "mine" ? "Your listings" : "All listings"}
          </p>
          {loadingListings ? (
            <p className="text-xs text-slate-400">Loading…</p>
          ) : null}
        </div>

        {listingsError ? (
          <div className="p-5">
            <p className="text-sm text-rose-200">{listingsError}</p>
          </div>
        ) : null}

        <div className="divide-y divide-white/10">
          {listings.map((listing, index) => (
            <div
              key={`${String(listing?._id ?? "listing")}-${index}`}
              className="grid gap-3 p-5 sm:grid-cols-12 sm:items-center"
            >
              <div className="sm:col-span-7">
                <p className="text-sm font-semibold text-white">{listing.title}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {listing.suburb} • {listing.bedrooms} bed • ${listing.pricePerMonth}/mo
                </p>
              </div>
              <div className="flex flex-wrap gap-2 sm:col-span-5 sm:justify-end">
                <button
                  type="button"
                  onClick={() => handleToggleStatus(listing)}
                  className="rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5"
                >
                  {listing.status === "draft" ? "Publish" : "Set draft"}
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(listing._id)}
                  className="rounded-full border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-400/15"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}

          {!loadingListings && listings.length === 0 ? (
            <div className="p-5">
              <p className="text-sm text-slate-300">No listings yet.</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
