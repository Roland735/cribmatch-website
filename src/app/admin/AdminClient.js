"use client";

import Image from "next/image";
import { signOut } from "next-auth/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

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

const RESIDENTIAL_TYPES = ["Apartment", "House", "Cottage", "Garden flat", "Townhouse"];

const BOARDING_TYPES = ["Boarding house (university)", "Boarding house", "Student accommodation", "Room"];

const COMMERCIAL_TYPES = ["Office", "Shop", "Retail warehouse", "Warehouse", "Factory", "Workshop"];

const RENT_A_CHAIR_TYPES = ["Barbering", "Hair Styling", "Nail Services", "Makeup Artistry", "Massage Therapy", "Other Services"];

const LAND_TYPES = ["Farm", "Stand", "Plot"];

const RESIDENTIAL_FEATURES = [
  "Borehole",
  "Solar Backup",
  "Solar Geyser",
  "Internet",
  "Fenced/Secure",
  "Garage",
  "Garden",
  "Furnished",
  "Pets Allowed",
  "Air Conditioning",
];

const BOARDING_FEATURES = [
  "Meals Included",
  "WiFi / Internet",
  "Laundry Service",
  "Shared Kitchen",
  "Study Area",
  "Common Room / Lounge",
  "Parking Available",
  "24/7 Security",
  "Cleaning Service",
  "Utilities Included",
  "Near Public Transport",
  "Near University/College",
];

const COMMERCIAL_FEATURES = [
  "High Foot Traffic",
  "Parking Available",
  "Loading Bay/Dock",
  "Air Conditioning",
  "Security System",
  "Storage Space",
  "Backup Power",
];

const CHAIR_FEATURES = [
  "Private Space",
  "Shared Space",
  "All Inclusive",
  "Furnished",
  "Parking Available",
  "Utilities Included",
];

const BOARDING_OCCUPANCY_OPTIONS = ["1 Person", "2 People", "3 People", "4+ People"];
const BOARDING_GENDER_OPTIONS = ["Male Only", "Female Only", "Mixed"];
const BOARDING_DURATION_OPTIONS = ["Short Term (1-3 months)", "Medium Term (3-6 months)", "Long Term (6+ months)"];

function formatUsdAmount(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(2) : "0.00";
}

function getNeighborhoodLabel(value) {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!raw) return "";
  return raw.split(",")[0]?.trim() || raw;
}

export default function AdminClient({ scope = "all", showSignOut = true } = {}) {
  const searchParams = useSearchParams();
  const canManagePricing = scope === "all";
  const canManageMarketing = scope === "all";
  const [activeTab, setActiveTab] = useState("listings");
  const [stats, setStats] = useState(null);
  const [reports, setReports] = useState([]);
  const [loadingStats, setLoadingStats] = useState(false);
  const [loadingReports, setLoadingReports] = useState(false);
  const [listings, setListings] = useState([]);
  const [loadingListings, setLoadingListings] = useState(false);
  const [listingsError, setListingsError] = useState("");
  const [selectedListingIds, setSelectedListingIds] = useState(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [sortBy, setSortBy] = useState("newest"); // newest, oldest, approved, unapproved
  const [marketingFilter, setMarketingFilter] = useState("all"); // all, approved, pending
  const [marketingSort, setMarketingSort] = useState("newest");
  const [marketingSearch, setMarketingSearch] = useState("");
  const [marketingSuburb, setMarketingSuburb] = useState("");
  const [marketingCity, setMarketingCity] = useState("");
  const [marketingPropertyCategory, setMarketingPropertyCategory] = useState("");
  const [marketingPropertyType, setMarketingPropertyType] = useState("");
  const [marketingMinPrice, setMarketingMinPrice] = useState("");
  const [marketingMaxPrice, setMarketingMaxPrice] = useState("");
  const [marketingMinDeposit, setMarketingMinDeposit] = useState("");
  const [marketingMaxDeposit, setMarketingMaxDeposit] = useState("");
  const [marketingMinBeds, setMarketingMinBeds] = useState("");
  const [marketingMaxBeds, setMarketingMaxBeds] = useState("");
  const [marketingFeatures, setMarketingFeatures] = useState([]);
  const [selectedMarketingIds, setSelectedMarketingIds] = useState(new Set());
  const [generatedPost, setGeneratedPost] = useState(null); // { id, text }
  const [pricing, setPricing] = useState({
    contactUnlockPriceUsd: 2.5,
    landlordListingPriceUsd: 0,
  });
  const [pricingForm, setPricingForm] = useState({
    contactUnlockPriceUsd: "2.50",
    landlordListingPriceUsd: "0.00",
  });
  const [pricingError, setPricingError] = useState("");
  const [pricingSaving, setPricingSaving] = useState(false);
  const [loadingPricing, setLoadingPricing] = useState(false);

  const [title, setTitle] = useState("");
  const [city, setCity] = useState("Harare");
  const [suburb, setSuburb] = useState("");
  const [propertyCategory, setPropertyCategory] = useState("residential");
  const [propertyType, setPropertyType] = useState(RESIDENTIAL_TYPES[0]);
  const [occupancy, setOccupancy] = useState("");
  const [genderPreference, setGenderPreference] = useState("");
  const [duration, setDuration] = useState("");
  const [numberOfStudents, setNumberOfStudents] = useState("");
  const [pricePerMonth, setPricePerMonth] = useState("");
  const [deposit, setDeposit] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [description, setDescription] = useState("");
  const [selectedFeatures, setSelectedFeatures] = useState([]);
  const [customFeature, setCustomFeature] = useState("");
  const [imageUploads, setImageUploads] = useState([]);
  const [status, setStatus] = useState("published");
  const [approved, setApproved] = useState(false);
  const [editingListingId, setEditingListingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [cities, setCities] = useState([]);
  const [suburbsByCity, setSuburbsByCity] = useState({});
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

  const availableSuburbs = useMemo(() => {
    const selectedCity = city.trim();
    if (!selectedCity) return [];
    const list = suburbsByCity?.[selectedCity];
    return Array.isArray(list) ? list : [];
  }, [city, suburbsByCity]);

  const featureOptions = useMemo(() => {
    if (propertyCategory === "boarding") return BOARDING_FEATURES;
    if (propertyCategory === "commercial") return COMMERCIAL_FEATURES;
    if (propertyCategory === "rent_a_chair") return CHAIR_FEATURES;
    return RESIDENTIAL_FEATURES;
  }, [propertyCategory]);

  const formValidationError = useMemo(() => {
    if (!title.trim()) return "Title is required.";
    if (!city.trim()) return "City is required.";
    if (!suburb.trim()) return "Suburb is required.";
    if (!propertyType.trim()) return "Property type is required.";

    const priceValue = toNumber(pricePerMonth);
    if (priceValue === null || priceValue < 0) return "Price per month must be a non-negative number.";

    const depositValue = deposit.trim() ? toNumber(deposit) : 0;
    if (deposit.trim() && (depositValue === null || depositValue < 0)) {
      return "Deposit must be a non-negative number.";
    }

    const bedroomsValue = toNumber(bedrooms);
    if (bedroomsValue === null || bedroomsValue < 0) return "Bedrooms must be a non-negative number.";

    if (propertyCategory === "boarding") {
      if (!occupancy.trim()) return "Occupancy is required for boarding listings.";
      if (!genderPreference.trim()) return "Gender preference is required for boarding listings.";
      if (!duration.trim()) return "Duration is required for boarding listings.";
      const studentsValue = toNumber(numberOfStudents);
      if (studentsValue === null || studentsValue <= 0 || !Number.isInteger(studentsValue)) {
        return "Number of students must be a whole number greater than zero.";
      }
    }

    if (hasUploadsInProgress) return "Please wait for image uploads to finish.";
    return "";
  }, [
    bedrooms,
    city,
    deposit,
    duration,
    genderPreference,
    hasUploadsInProgress,
    numberOfStudents,
    occupancy,
    pricePerMonth,
    propertyCategory,
    propertyType,
    suburb,
    title,
  ]);

  const canSubmit = useMemo(() => {
    return !saving && !formValidationError;
  }, [formValidationError, saving]);

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

        try {
          setImageUploads((current) =>
            current.map((entry) => (entry.id === item.id ? { ...entry, progress: 10 } : entry)),
          );

          const body = new FormData();
          body.append("file", file);
          const response = await fetch("/api/uploads/listing-image", {
            method: "POST",
            body,
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload?.error || "Upload failed");
          }
          const publicUrl = typeof payload?.url === "string" ? payload.url.trim() : "";
          if (!publicUrl) {
            throw new Error("Upload returned an empty image URL");
          }

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

  const loadStats = useCallback(async () => {
    try {
      setLoadingStats(true);
      const response = await fetch("/api/admin/stats");
      const data = await response.json();
      if (response.ok) setStats(data);
    } catch (err) {
      console.error("Load stats error:", err);
    } finally {
      setLoadingStats(false);
    }
  }, []);

  const loadReports = useCallback(async () => {
    try {
      setLoadingReports(true);
      const response = await fetch("/api/admin/reports");
      const data = await response.json();
      if (response.ok) setReports(data.reports || []);
    } catch (err) {
      console.error("Load reports error:", err);
    } finally {
      setLoadingReports(false);
    }
  }, []);

  const loadPricing = useCallback(async () => {
    try {
      setLoadingPricing(true);
      setPricingError("");
      const response = await fetch("/api/admin/pricing");
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to load pricing");
      }
      const nextPricing = {
        contactUnlockPriceUsd: Number(data?.pricing?.contactUnlockPriceUsd ?? 2.5),
        landlordListingPriceUsd: Number(data?.pricing?.landlordListingPriceUsd ?? 0),
      };
      setPricing(nextPricing);
      setPricingForm({
        contactUnlockPriceUsd: formatUsdAmount(nextPricing.contactUnlockPriceUsd),
        landlordListingPriceUsd: formatUsdAmount(nextPricing.landlordListingPriceUsd),
      });
    } catch (err) {
      setPricingError(err?.message || "Failed to load pricing");
    } finally {
      setLoadingPricing(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "listings" || (activeTab === "marketing" && canManageMarketing)) loadListings();
    if (activeTab === "stats") loadStats();
    if (activeTab === "reports") loadReports();
    if (activeTab === "pricing" && canManagePricing) loadPricing();
  }, [activeTab, canManageMarketing, canManagePricing, loadListings, loadStats, loadReports, loadPricing]);

  const loadLocationFacets = useCallback(async () => {
    try {
      const response = await fetch("/api/listings/facets");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return;
      const nextCities = Array.isArray(payload?.cities)
        ? payload.cities.map((value) => (typeof value === "string" ? value.trim() : "")).filter(Boolean)
        : [];
      const nextSuburbsByCityRaw =
        payload?.suburbsByCity && typeof payload.suburbsByCity === "object"
          ? payload.suburbsByCity
          : {};
      const nextSuburbsByCity = Object.entries(nextSuburbsByCityRaw).reduce((acc, [cityName, list]) => {
        const cityKey = typeof cityName === "string" ? cityName.trim() : "";
        if (!cityKey || !Array.isArray(list)) return acc;
        acc[cityKey] = Array.from(
          new Set(
            list
              .map((item) => getNeighborhoodLabel(item))
              .filter(Boolean),
          ),
        ).sort((a, b) => a.localeCompare(b));
        return acc;
      }, {});
      setCities(nextCities);
      setSuburbsByCity(nextSuburbsByCity);
    } catch { }
  }, []);

  useEffect(() => {
    if (activeTab === "listings") {
      loadLocationFacets();
    }
  }, [activeTab, loadLocationFacets]);

  const [isFormOpen, setIsFormOpen] = useState(false);

  useEffect(() => {
    if (searchParams.get("create") === "true") {
      setIsFormOpen(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [searchParams]);

  async function handleSave(event) {
    event.preventDefault();
    const validationError = formValidationError;
    if (validationError) {
      setSaveError(validationError);
      return;
    }
    setSaving(true);
    setSaveError("");

    try {
      const url = editingListingId
        ? `/api/listings/${editingListingId}`
        : "/api/listings";
      const method = editingListingId ? "PATCH" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          city: city.trim(),
          suburb: suburb.trim(),
          propertyCategory,
          propertyType: propertyType.trim(),
          occupancy: propertyCategory === "boarding" ? occupancy.trim() : "",
          genderPreference: propertyCategory === "boarding" ? genderPreference.trim() : "",
          duration: propertyCategory === "boarding" ? duration.trim() : "",
          numberOfStudents:
            propertyCategory === "boarding" ? Math.floor(Number(numberOfStudents)) : null,
          pricePerMonth: toNumber(pricePerMonth),
          deposit: toNumber(deposit),
          bedrooms: toNumber(bedrooms),
          description: description.trim(),
          features: cleanedFeatures,
          images: cleanedImages,
          status,
          approved,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `Failed to ${editingListingId ? "update" : "create"} listing`);
      }

      handleCancelEdit();
      await loadListings();
    } catch (error) {
      setSaveError(error?.message || `Failed to ${editingListingId ? "update" : "create"} listing`);
    } finally {
      setSaving(false);
    }
  }

  function handleEditStart(listing) {
    const listingSuburbRaw = typeof listing.suburb === "string" ? listing.suburb : "";
    const listingSuburbValue = getNeighborhoodLabel(listingSuburbRaw);
    const listingCityFromSuburb = listingSuburbRaw.includes(",")
      ? listingSuburbRaw.split(",").map((part) => part.trim()).filter(Boolean).slice(-1)[0] || ""
      : "";
    setEditingListingId(listing._id);
    setIsFormOpen(true);
    setTitle(listing.title || "");
    setCity(listing.city || listingCityFromSuburb || "Harare");
    setSuburb(listingSuburbValue || "");
    setPropertyCategory(listing.propertyCategory || "residential");
    setPropertyType(listing.propertyType || RESIDENTIAL_TYPES[0]);
    setOccupancy(listing.occupancy || "");
    setGenderPreference(listing.genderPreference || "");
    setDuration(listing.duration || "");
    setNumberOfStudents(
      Number.isFinite(Number(listing.numberOfStudents)) ? String(Number(listing.numberOfStudents)) : "",
    );
    setPricePerMonth(listing.pricePerMonth?.toString() || "");
    setDeposit(listing.deposit?.toString() || "");
    setBedrooms(listing.bedrooms?.toString() || "");
    setDescription(listing.description || "");
    setSelectedFeatures(listing.features || []);
    setStatus(listing.status || "published");
    setApproved(listing.approved || false);
    setImageUploads(
      (listing.images || []).map((url) => ({
        id: randomId(),
        url,
        status: "done",
        progress: 100,
      }))
    );
    // Scroll to form
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleCancelEdit() {
    setEditingListingId(null);
    setIsFormOpen(false);
    setTitle("");
    setCity("Harare");
    setSuburb("");
    setPropertyCategory("residential");
    setPropertyType(RESIDENTIAL_TYPES[0]);
    setOccupancy("");
    setGenderPreference("");
    setDuration("");
    setNumberOfStudents("");
    setPricePerMonth("");
    setDeposit("");
    setBedrooms("");
    setDescription("");
    setSelectedFeatures([]);
    setCustomFeature("");
    clearUploads();
    setStatus("published");
    setApproved(false);
    setSaveError("");
  }

  async function handleDelete(id) {
    if (!confirm("Are you sure?")) return;
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

  async function handleToggleApproval(listing) {
    const nextApproved = !listing.approved;
    const response = await fetch(`/api/listings/${listing._id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved: nextApproved }),
    });
    if (response.ok) {
      await loadListings();
    }
  }

  async function handleUpdateReportStatus(reportId, nextStatus) {
    const response = await fetch("/api/admin/reports", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reportId, status: nextStatus }),
    });
    if (response.ok) {
      await loadReports();
    }
  }

  async function handleSavePricing() {
    setPricingSaving(true);
    setPricingError("");
    try {
      const contactUnlockPriceUsd = Number(pricingForm.contactUnlockPriceUsd);
      const landlordListingPriceUsd = Number(pricingForm.landlordListingPriceUsd);
      if (!Number.isFinite(contactUnlockPriceUsd) || contactUnlockPriceUsd < 0) {
        throw new Error("Unlock price must be a non-negative number.");
      }
      if (!Number.isFinite(landlordListingPriceUsd) || landlordListingPriceUsd < 0) {
        throw new Error("Landlord listing price must be a non-negative number.");
      }

      const response = await fetch("/api/admin/pricing", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contactUnlockPriceUsd, landlordListingPriceUsd }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to save pricing");
      }
      const nextPricing = {
        contactUnlockPriceUsd: Number(data?.pricing?.contactUnlockPriceUsd ?? contactUnlockPriceUsd),
        landlordListingPriceUsd: Number(data?.pricing?.landlordListingPriceUsd ?? landlordListingPriceUsd),
      };
      setPricing(nextPricing);
      setPricingForm({
        contactUnlockPriceUsd: formatUsdAmount(nextPricing.contactUnlockPriceUsd),
        landlordListingPriceUsd: formatUsdAmount(nextPricing.landlordListingPriceUsd),
      });
    } catch (error) {
      setPricingError(error?.message || "Failed to save pricing");
    } finally {
      setPricingSaving(false);
    }
  }

  const handleToggleSelectListing = (id) => {
    setSelectedListingIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAllListings = () => {
    if (selectedListingIds.size === listings.length) {
      setSelectedListingIds(new Set());
    } else {
      setSelectedListingIds(new Set(listings.map((l) => l._id)));
    }
  };

  const handleBulkAction = async (action) => {
    if (selectedListingIds.size === 0) return;
    if (action === "delete" && !confirm(`Delete ${selectedListingIds.size} listings?`)) return;

    try {
      setBulkActionLoading(true);
      const response = await fetch("/api/admin/listings/bulk", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ids: Array.from(selectedListingIds),
          action,
        }),
      });

      if (response.ok) {
        setSelectedListingIds(new Set());
        await loadListings();
      } else {
        const data = await response.json();
        alert(data.error || "Bulk action failed");
      }
    } catch (err) {
      console.error("Bulk action error:", err);
      alert("Something went wrong");
    } finally {
      setBulkActionLoading(false);
    }
  };

  const sortedListings = useMemo(() => {
    let result = [...listings];

    if (sortBy === "newest") {
      result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } else if (sortBy === "oldest") {
      result.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    } else if (sortBy === "approved") {
      result.sort((a, b) => (b.approved ? 1 : 0) - (a.approved ? 1 : 0));
    } else if (sortBy === "unapproved") {
      result.sort((a, b) => (a.approved ? 1 : 0) - (b.approved ? 1 : 0));
    }

    return result;
  }, [listings, sortBy]);

  const marketingCities = useMemo(() => {
    const derived = listings
      .map((listing) => {
        const direct = typeof listing?.city === "string" ? listing.city.trim() : "";
        if (direct) return direct;
        const suburbRaw = typeof listing?.suburb === "string" ? listing.suburb : "";
        if (!suburbRaw.includes(",")) return "";
        const parts = suburbRaw
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean);
        return parts[parts.length - 1] || "";
      })
      .filter(Boolean);
    return Array.from(new Set(derived)).sort((a, b) => a.localeCompare(b));
  }, [listings]);

  const marketingListings = useMemo(() => {
    let result = [...listings];

    // Filter by status
    if (marketingFilter === "approved") {
      result = result.filter((l) => l.approved);
    } else if (marketingFilter === "pending") {
      result = result.filter((l) => !l.approved);
    }

    // Filter by search (q)
    if (marketingSearch.trim()) {
      const q = marketingSearch.toLowerCase().trim();
      result = result.filter((l) =>
        l.title?.toLowerCase().includes(q) ||
        l.suburb?.toLowerCase().includes(q) ||
        l.description?.toLowerCase().includes(q) ||
        l.features?.some(f => f.toLowerCase().includes(q))
      );
    }

    // Filter by suburb
    if (marketingSuburb) {
      result = result.filter((l) => l.suburb === marketingSuburb);
    }

    // Filter by city
    if (marketingCity) {
      const target = marketingCity.trim();
      result = result.filter((l) => {
        const direct = typeof l.city === "string" ? l.city.trim() : "";
        if (direct) return direct === target;
        const suburbRaw = typeof l.suburb === "string" ? l.suburb : "";
        if (!suburbRaw.includes(",")) return false;
        const parts = suburbRaw
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean);
        const derived = parts[parts.length - 1] || "";
        return derived === target;
      });
    }

    // Filter by property category
    if (marketingPropertyCategory) {
      result = result.filter((l) => l.propertyCategory === marketingPropertyCategory);
    }

    // Filter by property type
    if (marketingPropertyType) {
      result = result.filter((l) => l.propertyType === marketingPropertyType);
    }

    // Filter by price
    if (marketingMinPrice) {
      const min = parseFloat(marketingMinPrice);
      if (!isNaN(min)) {
        result = result.filter((l) => (l.pricePerMonth || 0) >= min);
      }
    }
    if (marketingMaxPrice) {
      const max = parseFloat(marketingMaxPrice);
      if (!isNaN(max)) {
        result = result.filter((l) => (l.pricePerMonth || 0) <= max);
      }
    }

    // Filter by deposit
    if (marketingMinDeposit) {
      const min = parseFloat(marketingMinDeposit);
      if (!isNaN(min)) {
        result = result.filter((l) => (l.deposit || 0) >= min);
      }
    }
    if (marketingMaxDeposit) {
      const max = parseFloat(marketingMaxDeposit);
      if (!isNaN(max)) {
        result = result.filter((l) => (l.deposit || 0) <= max);
      }
    }

    // Filter by beds
    if (marketingMinBeds) {
      const min = parseInt(marketingMinBeds);
      if (!isNaN(min)) {
        result = result.filter((l) => (l.bedrooms || 0) >= min);
      }
    }
    if (marketingMaxBeds) {
      const max = parseInt(marketingMaxBeds);
      if (!isNaN(max)) {
        result = result.filter((l) => (l.bedrooms || 0) <= max);
      }
    }

    // Filter by features
    if (marketingFeatures.length > 0) {
      result = result.filter((l) =>
        marketingFeatures.every((f) =>
          l.features?.some((lf) => lf.toLowerCase().includes(f.toLowerCase()))
        )
      );
    }

    // Sort
    if (marketingSort === "newest") {
      result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } else if (marketingSort === "oldest") {
      result.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    }

    return result;
  }, [listings, marketingFilter, marketingSort, marketingSearch, marketingSuburb, marketingCity, marketingPropertyCategory, marketingPropertyType, marketingMinPrice, marketingMaxPrice, marketingMinDeposit, marketingMaxDeposit, marketingMinBeds, marketingMaxBeds, marketingFeatures]);

  const formatMarketingRange = (minValue, maxValue, unit = "") => {
    const min = typeof minValue === "string" ? minValue.trim() : "";
    const max = typeof maxValue === "string" ? maxValue.trim() : "";
    if (!min && !max) return "";
    if (min && max) return `${unit}${min}-${unit}${max}`;
    if (min) return `From ${unit}${min}`;
    return `Up to ${unit}${max}`;
  };

  const buildMarketingParamsSummary = () => {
    const parts = [];
    if (marketingFilter && marketingFilter !== "all") {
      parts.push(`Status: ${marketingFilter === "approved" ? "Approved" : "Pending"}`);
    }
    if (marketingSearch.trim()) {
      parts.push(`Keywords: ${marketingSearch.trim()}`);
    }
    if (marketingCity.trim()) {
      parts.push(`City: ${marketingCity.trim()}`);
    }
    if (marketingSuburb.trim()) {
      parts.push(`Suburb: ${marketingSuburb.trim()}`);
    }
    if (marketingPropertyCategory.trim()) {
      parts.push(`Category: ${marketingPropertyCategory.trim()}`);
    }
    if (marketingPropertyType.trim()) {
      parts.push(`Type: ${marketingPropertyType.trim()}`);
    }
    const priceLabel = formatMarketingRange(marketingMinPrice, marketingMaxPrice, "$");
    if (priceLabel) {
      parts.push(`Price: ${priceLabel}`);
    }
    const depositLabel = formatMarketingRange(marketingMinDeposit, marketingMaxDeposit, "$");
    if (depositLabel) {
      parts.push(`Deposit: ${depositLabel}`);
    }
    const bedsLabel = formatMarketingRange(marketingMinBeds, marketingMaxBeds);
    if (bedsLabel) {
      parts.push(`Beds: ${bedsLabel}`);
    }
    if (marketingFeatures.length > 0) {
      parts.push(`Amenities: ${marketingFeatures.join(", ")}`);
    }
    return parts.length > 0 ? `✨ Handpicked for you: ${parts.join(" • ")}` : "";
  };

  const markListingsMarketed = useCallback(async (ids) => {
    if (!Array.isArray(ids) || ids.length === 0) return;
    try {
      const response = await fetch("/api/admin/listings/bulk", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, action: "mark_marketed" }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to tag listings as marketed");
      }
      await loadListings();
    } catch (error) {
      alert(error?.message || "Failed to tag listings as marketed");
    }
  }, [loadListings]);

  const generateFBPost = (listing) => {
    const title = (listing.title || "New Listing").toUpperCase();
    const suburb = (listing.suburb || "Location").toUpperCase();
    const featuresStr = listing.features?.length > 0
      ? `\n✨ Amenities: ${listing.features.join(", ")}`
      : "";
    const filtersSummary = buildMarketingParamsSummary();

    return `${filtersSummary ? `${filtersSummary}\n\n` : ""}🏠 ${title} AVAILABLE IN ${suburb}!

💰 Price: $${listing.pricePerMonth || 0}/month
🛏️ Bedrooms: ${listing.bedrooms || 0}
📍 Location: ${listing.suburb || "Unknown"}
🏠 Type: ${listing.propertyType || "Property"}
${featuresStr}

📝 Description:
${listing.description || "No description available."}

Interested? Contact us today!
#CribMatch #Accommodation #Rental #RealEstate #ForRent`;
  };

  const generateBulkFBPost = (selectedListings) => {
    if (selectedListings.length === 0) return "";

    // Determine a header based on search params
    let header = "🔥 HOT LISTINGS AVAILABLE NOW!";
    if (marketingSuburb) {
      header = `🔥 HOT LISTINGS IN ${marketingSuburb.toUpperCase()}!`;
    } else if (marketingCity) {
      header = `🔥 HOT LISTINGS IN ${marketingCity.toUpperCase()}!`;
    } else if (marketingSearch) {
      header = `🔥 TOP ${marketingSearch.toUpperCase()} LISTINGS!`;
    }

    const filtersSummary = buildMarketingParamsSummary();
    let postText = `${header}\n${filtersSummary ? `${filtersSummary}\n` : ""}\n`;

    selectedListings.forEach((listing, index) => {
      const title = (listing.title || "Property").toUpperCase();
      const price = listing.pricePerMonth ? `$${listing.pricePerMonth}` : "Contact for price";
      const features = listing.features?.length > 0 ? `\n✨ Amenities: ${listing.features.join(", ")}` : "";

      postText += `${index + 1}. 🏠 ${title}\n`;
      postText += `📍 Location: ${listing.suburb || "Unknown"}\n`;
      postText += `💰 Price: ${price}/month\n`;
      postText += `🛏️ Beds: ${listing.bedrooms || 0} | Type: ${listing.propertyType || "Property"}\n`;
      postText += `${features}\n\n`;
    });

    postText += `Interested in any of these? Contact us today for viewing!\n`;
    postText += `#CribMatch #HarareRealEstate #Accommodation #Rental #ForRent`;

    return postText;
  };

  return (
    <div className="mt-10 space-y-8">
      {/* Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex rounded-full border border-white/10 bg-slate-900/40 p-1">
          <button
            onClick={() => setActiveTab("listings")}
            className={`rounded-full px-6 py-2 text-sm font-semibold transition ${activeTab === "listings"
              ? "bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-400/20"
              : "text-slate-400 hover:text-white"
              }`}
          >
            Listings
          </button>
          <button
            onClick={() => setActiveTab("stats")}
            className={`rounded-full px-6 py-2 text-sm font-semibold transition ${activeTab === "stats"
              ? "bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-400/20"
              : "text-slate-400 hover:text-white"
              }`}
          >
            Stats
          </button>
          <button
            onClick={() => setActiveTab("reports")}
            className={`rounded-full px-6 py-2 text-sm font-semibold transition ${activeTab === "reports"
              ? "bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-400/20"
              : "text-slate-400 hover:text-white"
              }`}
          >
            Reports
          </button>
          {canManagePricing ? (
            <button
              onClick={() => setActiveTab("pricing")}
              className={`rounded-full px-6 py-2 text-sm font-semibold transition ${activeTab === "pricing"
                ? "bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-400/20"
                : "text-slate-400 hover:text-white"
                }`}
            >
              Pricing
            </button>
          ) : null}
          {canManageMarketing ? (
            <button
              onClick={() => setActiveTab("marketing")}
              className={`rounded-full px-6 py-2 text-sm font-semibold transition ${activeTab === "marketing"
                ? "bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-400/20"
                : "text-slate-400 hover:text-white"
                }`}
            >
              Marketing
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          {activeTab === "listings" && !isFormOpen && (
            <button
              type="button"
              onClick={() => setIsFormOpen(true)}
              className="rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300"
            >
              Create listing
            </button>
          )}
          {showSignOut && (
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/" })}
              className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5"
            >
              Sign out
            </button>
          )}
        </div>
      </div>

      {activeTab === "listings" && (
        <div className="space-y-8">
          {isFormOpen && (
            <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
              <p className="text-sm font-semibold text-white">
                {editingListingId ? "Edit listing" : "Create listing"}
              </p>
              <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={handleSave}>
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
                  <label className="block text-sm font-medium text-slate-200" htmlFor="city">
                    City
                  </label>
                  <select
                    id="city"
                    value={city}
                    onChange={(e) => {
                      setCity(e.target.value);
                      setSuburb("");
                    }}
                    className="mt-2 block w-full appearance-none rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 pr-10 text-sm text-slate-50 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
                  >
                    <option value="">Select city</option>
                    {Array.from(new Set([city, ...cities].filter(Boolean))).map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-200" htmlFor="suburb">
                    Suburb
                  </label>
                  <select
                    id="suburb"
                    value={suburb}
                    onChange={(e) => setSuburb(e.target.value)}
                    disabled={!city.trim()}
                    className="mt-2 block w-full appearance-none rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 pr-10 text-sm text-slate-50 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="">{city.trim() ? "Select suburb" : "Select city first"}</option>
                    {Array.from(new Set([suburb, ...availableSuburbs].filter(Boolean))).map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
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
                        nextRaw === "commercial" || nextRaw === "boarding" || nextRaw === "rent_a_chair" || nextRaw === "land"
                          ? nextRaw
                          : "residential";
                      setPropertyCategory(next);
                      setSelectedFeatures([]);
                      if (next === "commercial") {
                        setPropertyType(COMMERCIAL_TYPES[0]);
                        setBedrooms("0");
                      } else if (next === "land") {
                        setPropertyType(LAND_TYPES[0]);
                        setBedrooms("0");
                      } else if (next === "rent_a_chair") {
                        setPropertyType(RENT_A_CHAIR_TYPES[0]);
                        setBedrooms("0");
                      } else if (next === "boarding") {
                        setPropertyType(BOARDING_TYPES[0]);
                      } else {
                        setPropertyType(RESIDENTIAL_TYPES[0]);
                      }
                      if (next !== "boarding") {
                        setOccupancy("");
                        setGenderPreference("");
                        setDuration("");
                        setNumberOfStudents("");
                      }
                    }}
                    className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
                  >
                    <option value="residential">Residential</option>
                    <option value="boarding">Boarding</option>
                    <option value="commercial">Commercial</option>
                    <option value="rent_a_chair">Rent a chair</option>
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
                        : propertyCategory === "rent_a_chair"
                          ? RENT_A_CHAIR_TYPES
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
                    placeholder="650"
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
                    placeholder={
                      propertyCategory === "commercial" || propertyCategory === "land" || propertyCategory === "rent_a_chair"
                        ? "0"
                        : "2"
                    }
                  />
                </div>

                {propertyCategory === "boarding" ? (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-slate-200" htmlFor="occupancy">
                        Occupancy
                      </label>
                      <select
                        id="occupancy"
                        value={occupancy}
                        onChange={(e) => setOccupancy(e.target.value)}
                        className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
                      >
                        <option value="">Select occupancy</option>
                        {BOARDING_OCCUPANCY_OPTIONS.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-200" htmlFor="genderPreference">
                        Gender preference
                      </label>
                      <select
                        id="genderPreference"
                        value={genderPreference}
                        onChange={(e) => setGenderPreference(e.target.value)}
                        className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
                      >
                        <option value="">Select gender preference</option>
                        {BOARDING_GENDER_OPTIONS.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-200" htmlFor="duration">
                        Duration
                      </label>
                      <select
                        id="duration"
                        value={duration}
                        onChange={(e) => setDuration(e.target.value)}
                        className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
                      >
                        <option value="">Select duration</option>
                        {BOARDING_DURATION_OPTIONS.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-200" htmlFor="numberOfStudents">
                        Number of students
                      </label>
                      <input
                        id="numberOfStudents"
                        inputMode="numeric"
                        value={numberOfStudents}
                        onChange={(e) => setNumberOfStudents(e.target.value)}
                        className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
                        placeholder="1"
                      />
                    </div>
                  </>
                ) : null}

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
                    <option value="archived">Archived</option>
                  </select>
                </div>

                <div className="flex items-center gap-2 py-4">
                  <input
                    id="approved"
                    type="checkbox"
                    checked={approved}
                    onChange={(e) => setApproved(e.target.checked)}
                    className="h-4 w-4 rounded border-white/10 bg-slate-950/60 text-emerald-400 outline-none focus:ring-2 focus:ring-emerald-400/30"
                  />
                  <label htmlFor="approved" className="text-sm font-medium text-slate-200">
                    Approved by admin
                  </label>
                </div>

                <div className="sm:col-span-2">
                  <p className="block text-sm font-medium text-slate-200">Features</p>
                  <p className="mt-1 text-xs text-slate-400">Select up to 12.</p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {featureOptions.map((feature) => {
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
                </div>

                <div className="sm:col-span-2">
                  <p className="block text-sm font-medium text-slate-200">Pictures</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Upload photos to Storage (up to 12). The first one is the cover.
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
                      className={`cursor-pointer rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5 ${imageUploads.length >= 12 ? "pointer-events-none opacity-60" : ""}`}
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
                      <span className="text-xs text-slate-400 animate-pulse">Uploading…</span>
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
                                className="h-24 w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-24 w-full items-center justify-center text-xs text-slate-500">
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
                              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/60 text-xs font-semibold text-slate-50">
                                <div className="h-1 w-20 bg-white/10 rounded-full overflow-hidden mb-1">
                                  <div className="h-full bg-emerald-400 transition-all duration-300" style={{ width: `${item.progress}%` }} />
                                </div>
                                {item.progress}%
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

                <div className="flex items-center justify-end gap-3 pt-4 sm:col-span-2">
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving ? "Saving…" : editingListingId ? "Save changes" : "Create listing"}
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="rounded-3xl border border-white/10 bg-slate-900/40">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 p-5">
              <div className="flex items-center gap-4">
                <input
                  type="checkbox"
                  checked={listings.length > 0 && selectedListingIds.size === listings.length}
                  onChange={handleSelectAllListings}
                  className="h-4 w-4 rounded border-white/10 bg-slate-950/60 text-emerald-400 focus:ring-emerald-400/30"
                />
                <p className="text-sm font-semibold text-white">
                  {scope === "mine" ? "Your listings" : "All listings"}
                  {selectedListingIds.size > 0 && (
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      ({selectedListingIds.size} selected)
                    </span>
                  )}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {selectedListingIds.size > 0 && (
                  <div className="mr-2 flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/40 p-1">
                    <button
                      onClick={() => handleBulkAction("approve")}
                      disabled={bulkActionLoading}
                      className="rounded-full px-3 py-1 text-[10px] font-bold text-emerald-400 hover:bg-emerald-400/10 disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleBulkAction("unapprove")}
                      disabled={bulkActionLoading}
                      className="rounded-full px-3 py-1 text-[10px] font-bold text-amber-400 hover:bg-amber-400/10 disabled:opacity-50"
                    >
                      Unapprove
                    </button>
                    <button
                      onClick={() => handleBulkAction("draft")}
                      disabled={bulkActionLoading}
                      className="rounded-full px-3 py-1 text-[10px] font-bold text-slate-400 hover:bg-white/10 disabled:opacity-50"
                    >
                      Draft
                    </button>
                    <button
                      onClick={() => handleBulkAction("delete")}
                      disabled={bulkActionLoading}
                      className="rounded-full px-3 py-1 text-[10px] font-bold text-rose-400 hover:bg-rose-400/10 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                )}
                {loadingListings && (
                  <p className="text-xs text-slate-400 animate-pulse">Loading…</p>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Sort:</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1 text-[10px] text-white focus:border-emerald-400 focus:outline-none"
                  >
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="approved">Approved</option>
                    <option value="unapproved">Unapproved</option>
                  </select>
                </div>
              </div>
            </div>

            {listingsError ? (
              <div className="p-5">
                <p className="text-sm text-rose-200">{listingsError}</p>
              </div>
            ) : null}

            <div className="divide-y divide-white/10">
              {sortedListings.map((listing, index) => (
                <div
                  key={`${String(listing?._id ?? "listing")}-${index}`}
                  className={`grid gap-4 p-5 sm:grid-cols-12 sm:items-center transition ${selectedListingIds.has(listing._id) ? "bg-emerald-400/5" : ""
                    }`}
                >
                  <div className="sm:col-span-6 flex items-center gap-4">
                    <input
                      type="checkbox"
                      checked={selectedListingIds.has(listing._id)}
                      onChange={() => handleToggleSelectListing(listing._id)}
                      className="h-4 w-4 rounded border-white/10 bg-slate-950/60 text-emerald-400 focus:ring-emerald-400/30"
                    />
                    <div>
                      <div className="flex items-center gap-3">
                        <p className="text-sm font-semibold text-white">{listing.title}</p>
                        <div className="flex gap-1.5">
                          {listing.approved ? (
                            <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400 ring-1 ring-inset ring-emerald-400/20">
                              Approved
                            </span>
                          ) : (
                            <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold text-amber-400 ring-1 ring-inset ring-amber-400/20">
                              Pending
                            </span>
                          )}
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${listing.status === "published"
                            ? "bg-blue-400/10 text-blue-400 ring-blue-400/20"
                            : "bg-white/10 text-white/40 ring-white/20"
                            }`}>
                            {listing.status.toUpperCase()}
                          </span>
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">
                        {listing.city ? `${listing.city}, ` : ""}{listing.suburb} • {listing.bedrooms} bed • ${listing.pricePerMonth}/mo
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 sm:col-span-6 sm:justify-end">
                    <button
                      type="button"
                      onClick={() => handleToggleApproval(listing)}
                      className={`rounded-full border px-4 py-2 text-xs font-semibold transition ${listing.approved
                        ? "border-amber-400/30 text-amber-400 hover:bg-amber-400/5"
                        : "border-emerald-400/30 text-emerald-400 hover:bg-emerald-400/5"
                        }`}
                    >
                      {listing.approved ? "Unapprove" : "Approve"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEditStart(listing)}
                      className="rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5"
                    >
                      Edit
                    </button>
                    {listing.status === "published" && (
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(listing)}
                        className="rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-slate-50 transition hover:border-white/30 hover:bg-white/5"
                      >
                        Draft
                      </button>
                    )}
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
                <div className="p-10 text-center">
                  <p className="text-sm text-slate-400">No listings found.</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {activeTab === "stats" && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
              <p className="text-sm font-medium text-slate-400">Total Listings</p>
              <p className="mt-2 text-3xl font-bold text-white">{stats?.totalListings || 0}</p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
              <p className="text-sm font-medium text-slate-400">Pending Approval</p>
              <p className="mt-2 text-3xl font-bold text-amber-400">{stats?.pendingApproval || 0}</p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
              <p className="text-sm font-medium text-slate-400">Total Reports</p>
              <p className="mt-2 text-3xl font-bold text-rose-400">{stats?.totalReports || 0}</p>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
            <p className="text-sm font-semibold text-white">Recent Activity</p>
            <div className="mt-6 space-y-4">
              {stats?.recentPurchases?.length > 0 ? (
                stats.recentPurchases.map((purchase, idx) => (
                  <div key={idx} className="flex items-center justify-between border-b border-white/5 pb-4 last:border-0 last:pb-0">
                    <div>
                      <p className="text-sm font-medium text-white">{purchase.listingTitle}</p>
                      <p className="text-xs text-slate-400">{new Date(purchase.createdAt).toLocaleDateString()}</p>
                    </div>
                    <p className="text-sm font-semibold text-emerald-400">${purchase.amount}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">No recent activity.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === "reports" && (
        <div className="rounded-3xl border border-white/10 bg-slate-900/40">
          <div className="border-b border-white/10 p-5">
            <p className="text-sm font-semibold text-white">Listing Reports</p>
          </div>
          <div className="divide-y divide-white/10">
            {reports.length > 0 ? (
              reports.map((report, index) => (
                <div key={report._id || `report-${index}`} className="p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">Report for: {report.listingTitle}</p>
                      <p className="text-xs text-slate-400">By: {report.reporterName || "Anonymous"} • {new Date(report.createdAt).toLocaleDateString()}</p>
                    </div>
                    <select
                      value={report.status}
                      onChange={(e) => handleUpdateReportStatus(report._id, e.target.value)}
                      className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ring-inset ${report.status === "resolved"
                        ? "bg-emerald-400/10 text-emerald-400 ring-emerald-400/20"
                        : "bg-amber-400/10 text-amber-400 ring-amber-400/20"
                        }`}
                    >
                      <option value="pending">Pending</option>
                      <option value="resolved">Resolved</option>
                      <option value="dismissed">Dismissed</option>
                    </select>
                  </div>
                  <p className="text-sm text-slate-300 bg-slate-950/40 rounded-xl p-3 border border-white/5">
                    {report.reason}
                  </p>
                </div>
              ))
            ) : (
              <div className="p-10 text-center">
                <p className="text-sm text-slate-400">No reports found.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {canManagePricing && activeTab === "pricing" && (
        <div className="space-y-6">
          <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
            <p className="text-sm font-semibold text-white">Pricing controls</p>
            <p className="mt-2 text-sm text-slate-300">
              Set prices once and sync them across web checkout and WhatsApp flows.
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-slate-200" htmlFor="contactUnlockPriceUsd">
                  Unlock contact details (USD per listing)
                </label>
                <input
                  id="contactUnlockPriceUsd"
                  inputMode="decimal"
                  value={pricingForm.contactUnlockPriceUsd}
                  onChange={(event) =>
                    setPricingForm((current) => ({ ...current, contactUnlockPriceUsd: event.target.value }))
                  }
                  className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
                  placeholder="2.50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-200" htmlFor="landlordListingPriceUsd">
                  Landlord listing fee (USD per listing)
                </label>
                <input
                  id="landlordListingPriceUsd"
                  inputMode="decimal"
                  value={pricingForm.landlordListingPriceUsd}
                  onChange={(event) =>
                    setPricingForm((current) => ({ ...current, landlordListingPriceUsd: event.target.value }))
                  }
                  className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
                  placeholder="0.00"
                />
              </div>
            </div>

            {pricingError ? (
              <p className="mt-4 text-sm text-rose-200">{pricingError}</p>
            ) : null}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-400">
                Current: Unlock ${formatUsdAmount(pricing.contactUnlockPriceUsd)} • Landlord ${formatUsdAmount(pricing.landlordListingPriceUsd)}
              </p>
              <button
                type="button"
                onClick={handleSavePricing}
                disabled={pricingSaving || loadingPricing}
                className="rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pricingSaving ? "Saving..." : "Save pricing"}
              </button>
            </div>
          </div>
        </div>
      )}

      {canManageMarketing && activeTab === "marketing" && (
        <div className="space-y-8">
          <div className="rounded-3xl border border-white/10 bg-slate-900/40">
            <div className="flex flex-col gap-6 border-b border-white/10 p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">Marketing Tools</h2>
                  <p className="text-xs text-slate-400 mt-1">Filter and generate social media content for your listings.</p>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Listing Status</span>
                    <select
                      value={marketingFilter}
                      onChange={(e) => setMarketingFilter(e.target.value)}
                      className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/20 transition min-w-[120px]"
                    >
                      <option value="all">All Listings</option>
                      <option value="approved">Approved Only</option>
                      <option value="pending">Pending Only</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Sort By</span>
                    <select
                      value={marketingSort}
                      onChange={(e) => setMarketingSort(e.target.value)}
                      className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/20 transition min-w-[140px]"
                    >
                      <option value="newest">Newest First</option>
                      <option value="oldest">Oldest First</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Advanced Search Filters */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 bg-slate-950/40 p-6 rounded-2xl border border-white/5">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                    Keywords
                  </label>
                  <input
                    type="text"
                    value={marketingSearch}
                    onChange={(e) => setMarketingSearch(e.target.value)}
                    placeholder="Search title, suburb, or features..."
                    className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/20 transition"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                    City
                  </label>
                  <select
                    value={marketingCity}
                    onChange={(e) => setMarketingCity(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm text-white focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/20 transition"
                  >
                    <option value="">All Cities</option>
                    {marketingCities.map((city) => (
                      <option key={city} value={city}>{city}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    Suburb
                  </label>
                  <select
                    value={marketingSuburb}
                    onChange={(e) => setMarketingSuburb(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm text-white focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/20 transition"
                  >
                    <option value="">All Neighborhoods</option>
                    {Array.from(new Set(listings.map(l => l.suburb).filter(Boolean))).sort().map(suburb => (
                      <option key={suburb} value={suburb}>{suburb}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
                    Category
                  </label>
                  <select
                    value={marketingPropertyCategory}
                    onChange={(e) => setMarketingPropertyCategory(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm text-white focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/20 transition"
                  >
                    <option value="">All Categories</option>
                    {Array.from(new Set(listings.map(l => l.propertyCategory).filter(Boolean))).sort().map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m0 0l-7 7-7-7M19 10v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
                    Property Type
                  </label>
                  <select
                    value={marketingPropertyType}
                    onChange={(e) => setMarketingPropertyType(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm text-white focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/20 transition"
                  >
                    <option value="">All Types</option>
                    {Array.from(new Set(listings.map(l => l.propertyType).filter(Boolean))).sort().map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M12 16V15m0 1v1m4-14a2 2 0 00-2-2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V4z" /></svg>
                    Monthly Price
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
                      <input
                        type="number"
                        value={marketingMinPrice}
                        onChange={(e) => setMarketingMinPrice(e.target.value)}
                        placeholder="Min"
                        className="w-full rounded-xl border border-white/10 bg-slate-950/60 pl-7 pr-3 py-2.5 text-sm text-white focus:border-emerald-400 focus:outline-none transition"
                      />
                    </div>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
                      <input
                        type="number"
                        value={marketingMaxPrice}
                        onChange={(e) => setMarketingMaxPrice(e.target.value)}
                        placeholder="Max"
                        className="w-full rounded-xl border border-white/10 bg-slate-950/60 pl-7 pr-3 py-2.5 text-sm text-white focus:border-emerald-400 focus:outline-none transition"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                    Deposit Range
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
                      <input
                        type="number"
                        value={marketingMinDeposit}
                        onChange={(e) => setMarketingMinDeposit(e.target.value)}
                        placeholder="Min"
                        className="w-full rounded-xl border border-white/10 bg-slate-950/60 pl-7 pr-3 py-2.5 text-sm text-white focus:border-emerald-400 focus:outline-none transition"
                      />
                    </div>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
                      <input
                        type="number"
                        value={marketingMaxDeposit}
                        onChange={(e) => setMarketingMaxDeposit(e.target.value)}
                        placeholder="Max"
                        className="w-full rounded-xl border border-white/10 bg-slate-950/60 pl-7 pr-3 py-2.5 text-sm text-white focus:border-emerald-400 focus:outline-none transition"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                    Bedrooms Range
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="number"
                      value={marketingMinBeds}
                      onChange={(e) => setMarketingMinBeds(e.target.value)}
                      placeholder="Min"
                      className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm text-white focus:border-emerald-400 focus:outline-none transition"
                    />
                    <input
                      type="number"
                      value={marketingMaxBeds}
                      onChange={(e) => setMarketingMaxBeds(e.target.value)}
                      placeholder="Max"
                      className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm text-white focus:border-emerald-400 focus:outline-none transition"
                    />
                  </div>
                </div>

                <div className="space-y-2 md:col-span-2 xl:col-span-3">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-7.714 2.143L11 21l-2.286-6.857L1 12l7.714-2.143L11 3z" /></svg>
                    Select Features (Multi-select)
                  </label>
                  <div className="flex flex-wrap gap-2 p-3 rounded-xl border border-white/10 bg-slate-950/60 max-h-[150px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
                    {COMMON_FEATURES.map((feature) => (
                      <button
                        key={feature}
                        onClick={() => {
                          setMarketingFeatures((prev) =>
                            prev.includes(feature)
                              ? prev.filter((f) => f !== feature)
                              : [...prev, feature]
                          );
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${marketingFeatures.includes(feature)
                          ? "bg-emerald-400 text-slate-950 shadow-sm"
                          : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
                          }`}
                      >
                        {feature}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-end">
                  <button
                    onClick={() => {
                      setMarketingSearch("");
                      setMarketingSuburb("");
                      setMarketingCity("");
                      setMarketingPropertyCategory("");
                      setMarketingPropertyType("");
                      setMarketingMinPrice("");
                      setMarketingMaxPrice("");
                      setMarketingMinDeposit("");
                      setMarketingMaxDeposit("");
                      setMarketingMinBeds("");
                      setMarketingMaxBeds("");
                      setMarketingFeatures([]);
                      setMarketingFilter("all");
                      setMarketingSort("newest");
                    }}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-white/10 hover:text-white transition"
                  >
                    Reset Filters
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border-b border-white/10 bg-slate-950/20 p-4 px-6">
              <div className="flex items-center gap-4">
                <input
                  type="checkbox"
                  checked={marketingListings.length > 0 && marketingListings.every(l => selectedMarketingIds.has(l._id))}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedMarketingIds(new Set(marketingListings.map(l => l._id)));
                    } else {
                      setSelectedMarketingIds(new Set());
                    }
                  }}
                  className="h-4 w-4 rounded border-white/10 bg-slate-950/60 text-emerald-400 focus:ring-emerald-400/20"
                />
                <span className="text-xs font-semibold text-slate-300">
                  {selectedMarketingIds.size} selected
                </span>
              </div>
              <button
                onClick={async () => {
                  const selected = marketingListings.filter(l => selectedMarketingIds.has(l._id));
                  setGeneratedPost({ id: "bulk", text: generateBulkFBPost(selected) });
                  await markListingsMarketed(selected.map((listing) => listing._id).filter(Boolean));
                }}
                disabled={selectedMarketingIds.size === 0}
                className="rounded-xl bg-emerald-400 px-4 py-2 text-xs font-bold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Generate Bulk Post
              </button>
            </div>

            {generatedPost && generatedPost.id === "bulk" && (
              <div className="m-6 mt-4 rounded-2xl bg-slate-950/60 p-6 border border-white/5 shadow-2xl">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    Bulk Facebook Post Preview
                  </span>
                  <div className="flex gap-4">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(generatedPost.text);
                        alert("Bulk post copied to clipboard!");
                      }}
                      className="text-xs font-bold text-emerald-400 hover:text-emerald-300 transition"
                    >
                      Copy All
                    </button>
                    <button
                      onClick={() => setGeneratedPost(null)}
                      className="text-xs font-bold text-slate-500 hover:text-slate-300 transition"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
                <pre className="whitespace-pre-wrap text-sm text-slate-300 font-sans leading-relaxed max-h-[400px] overflow-y-auto pr-4 scrollbar-thin scrollbar-thumb-white/10">
                  {generatedPost.text}
                </pre>
              </div>
            )}

            <div className="divide-y divide-white/10">
              {marketingListings.map((listing, index) => (
                <div key={listing._id || `marketing-${index}`} className={`p-5 transition hover:bg-white/5 ${selectedMarketingIds.has(listing._id) ? 'bg-emerald-400/5' : ''}`}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <input
                        type="checkbox"
                        checked={selectedMarketingIds.has(listing._id)}
                        onChange={(e) => {
                          const next = new Set(selectedMarketingIds);
                          if (e.target.checked) {
                            next.add(listing._id);
                          } else {
                            next.delete(listing._id);
                          }
                          setSelectedMarketingIds(next);
                        }}
                        className="h-4 w-4 rounded border-white/10 bg-slate-950/60 text-emerald-400 focus:ring-emerald-400/20"
                      />
                      <div>
                        <p className="text-sm font-semibold text-white">{listing.title}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {listing.city ? `${listing.city}, ` : ""}{listing.suburb} • ${listing.pricePerMonth}/mo • {listing.bedrooms} Beds
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        setGeneratedPost({ id: listing._id, text: generateFBPost(listing) });
                        if (listing._id) {
                          await markListingsMarketed([listing._id]);
                        }
                      }}
                      className="rounded-full bg-blue-500/10 px-4 py-2 text-xs font-bold text-blue-400 ring-1 ring-inset ring-blue-500/20 hover:bg-blue-500/20 transition"
                    >
                      Preview Single
                    </button>
                  </div>

                  {generatedPost && listing._id && generatedPost.id === listing._id && (
                    <div className="mt-4 rounded-2xl bg-slate-950/60 p-4 border border-white/5">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Facebook Post Preview</span>
                        <div className="flex gap-3">
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(generatedPost.text);
                              alert("Copied to clipboard!");
                            }}
                            className="text-[10px] font-bold text-emerald-400 hover:text-emerald-300"
                          >
                            Copy Text
                          </button>
                          <button
                            onClick={() => setGeneratedPost(null)}
                            className="text-[10px] font-bold text-slate-500 hover:text-slate-300"
                          >
                            Close
                          </button>
                        </div>
                      </div>
                      <pre className="whitespace-pre-wrap text-xs text-slate-300 font-sans leading-relaxed">
                        {generatedPost.text}
                      </pre>
                    </div>
                  )}
                </div>
              ))}

              {marketingListings.length === 0 && (
                <div className="p-10 text-center">
                  <p className="text-sm text-slate-400">No listings found for marketing.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
