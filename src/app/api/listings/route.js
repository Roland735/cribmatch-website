import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbConnect, getPricingSettings, Listing, User } from "@/lib/db";
import {
  KNOWN_PROPERTY_CATEGORIES,
  KNOWN_PROPERTY_TYPES_BY_CATEGORY,
  searchListings,
} from "@/lib/getListings";

export const runtime = "nodejs";

function serializeListing(listing) {
  const obj =
    typeof listing?.toObject === "function" ? listing.toObject() : listing;
  return {
    ...obj,
    _id: obj?._id?.toString?.() ?? obj?._id,
    lister_type: obj?.listerType || "direct_landlord",
    agent_rate: typeof obj?.agentRate === "number" ? obj.agentRate : null,
    agent_profile_image_url: typeof obj?.agentProfileImageUrl === "string" ? obj.agentProfileImageUrl : "",
    createdAt: obj?.createdAt?.toISOString?.() ?? obj?.createdAt,
    updatedAt: obj?.updatedAt?.toISOString?.() ?? obj?.updatedAt,
  };
}

function toValidNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeListingPayload(body = {}) {
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const city = typeof body?.city === "string" ? body.city.trim() : "";
  const suburb = typeof body?.suburb === "string" ? body.suburb.trim() : "";
  const propertyCategoryRaw =
    typeof body?.propertyCategory === "string" ? body.propertyCategory.trim() : "";
  const propertyCategory = propertyCategoryRaw
    ? KNOWN_PROPERTY_CATEGORIES.includes(propertyCategoryRaw)
      ? propertyCategoryRaw
      : null
    : "residential";
  const propertyTypeRaw =
    typeof body?.propertyType === "string" ? body.propertyType.trim() : "";
  const propertyType =
    propertyCategory === "commercial" && propertyTypeRaw === "Retail"
      ? "Retail warehouse"
      : propertyTypeRaw;
  const allowedTypes = propertyCategory ? KNOWN_PROPERTY_TYPES_BY_CATEGORY[propertyCategory] || [] : [];
  const pricePerMonth = toValidNumber(body?.pricePerMonth);
  const deposit = toValidNumber(body?.deposit);
  const bedrooms = toValidNumber(body?.bedrooms);
  const description =
    typeof body?.description === "string" ? body.description.trim() : "";
  const features = Array.isArray(body?.features)
    ? body.features.filter((f) => typeof f === "string" && f.trim()).slice(0, 12)
    : [];
  const images = Array.isArray(body?.images)
    ? body.images
      .filter((url) => typeof url === "string" && url.trim())
      .slice(0, 12)
    : [];
  const contactName =
    typeof body?.contactName === "string" ? body.contactName.trim() : "";
  const contactPhone =
    typeof body?.contactPhone === "string" ? body.contactPhone.trim() : "";
  const contactWhatsApp =
    typeof body?.contactWhatsApp === "string"
      ? body.contactWhatsApp.trim()
      : "";
  const contactEmail =
    typeof body?.contactEmail === "string" ? body.contactEmail.trim() : "";
  const status = body?.status === "draft" ? "draft" : body?.status === "archived" ? "archived" : "published";
  const occupancy = typeof body?.occupancy === "string" ? body.occupancy.trim() : "";
  const genderPreference =
    typeof body?.genderPreference === "string" ? body.genderPreference.trim() : "";
  const duration = typeof body?.duration === "string" ? body.duration.trim() : "";
  const numberOfStudentsRaw = toValidNumber(body?.numberOfStudents);
  const numberOfStudents =
    numberOfStudentsRaw !== null ? Math.floor(numberOfStudentsRaw) : null;
  const listerType = typeof body?.listerType === "string" ? body.listerType.trim() : "";

  return {
    title,
    city,
    suburb,
    propertyCategory,
    propertyType,
    allowedTypes,
    pricePerMonth,
    deposit,
    bedrooms,
    description,
    features,
    images,
    contactName,
    contactPhone,
    contactWhatsApp,
    contactEmail,
    status,
    occupancy,
    genderPreference,
    duration,
    numberOfStudents,
    listerType,
  };
}

function validateListingPayload(payload) {
  if (!payload.propertyCategory) return "Invalid property category";
  if (!payload.propertyType || !payload.allowedTypes.includes(payload.propertyType)) {
    return "Invalid property type for category";
  }
  if (!payload.title || !payload.city || !payload.suburb) {
    return "Missing required fields";
  }
  if (payload.pricePerMonth === null || payload.pricePerMonth < 0) {
    return "Price per month must be a non-negative number";
  }
  if (payload.deposit !== null && payload.deposit < 0) {
    return "Deposit must be a non-negative number";
  }
  if (payload.bedrooms === null || payload.bedrooms < 0) {
    return "Bedrooms must be a non-negative number";
  }
  if (payload.propertyCategory === "boarding") {
    if (!payload.occupancy || !payload.genderPreference || !payload.duration) {
      return "Boarding listings require occupancy, gender preference, and duration";
    }
    if (
      payload.numberOfStudents === null ||
      payload.numberOfStudents <= 0
    ) {
      return "Boarding listings require number of students greater than zero";
    }
  }
  return "";
}

function normalizeMarketValue(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function computeMedian(values = []) {
  const numbers = values
    .map((item) => Number(item))
    .filter((num) => Number.isFinite(num) && num >= 0)
    .sort((a, b) => a - b);
  if (!numbers.length) return null;
  const middle = Math.floor(numbers.length / 2);
  if (numbers.length % 2 === 0) {
    return (numbers[middle - 1] + numbers[middle]) / 2;
  }
  return numbers[middle];
}

async function getMicroMarketMedianPrice({ city, suburb }) {
  const cityNorm = normalizeMarketValue(city);
  const suburbNorm = normalizeMarketValue(suburb);
  const baseQuery = {
    listerType: "direct_landlord",
    status: "published",
    approved: { $ne: false },
  };
  const directListings = await Listing.find(baseQuery)
    .select("pricePerMonth city suburb")
    .limit(1200)
    .lean();
  const bySuburb = directListings.filter((listing) => {
    if (!suburbNorm) return false;
    const listingSuburb = normalizeMarketValue(listing?.suburb);
    return listingSuburb === suburbNorm;
  });
  if (bySuburb.length) {
    return computeMedian(bySuburb.map((listing) => listing?.pricePerMonth));
  }
  const byCity = directListings.filter((listing) => {
    if (!cityNorm) return false;
    const listingCity = normalizeMarketValue(listing?.city);
    return listingCity === cityNorm;
  });
  if (byCity.length) {
    return computeMedian(byCity.map((listing) => listing?.pricePerMonth));
  }
  return computeMedian(directListings.map((listing) => listing?.pricePerMonth));
}

export async function GET(request) {
  const url = new URL(request.url);
  const includeAll = url.searchParams.get("all") === "1";
  const mine = url.searchParams.get("mine") === "1";
  const q = url.searchParams.get("q") ?? "";
  const city = url.searchParams.get("city") ?? "";
  const suburb = url.searchParams.get("suburb") ?? "";
  const propertyCategory = url.searchParams.get("propertyCategory") ?? "";
  const propertyType = url.searchParams.get("propertyType") ?? "";
  const minPrice = url.searchParams.get("minPrice");
  const maxPrice = url.searchParams.get("maxPrice");
  const minDeposit = url.searchParams.get("minDeposit");
  const maxDeposit = url.searchParams.get("maxDeposit");
  const minBeds = url.searchParams.get("minBeds");
  const maxBeds = url.searchParams.get("maxBeds");
  const sort = url.searchParams.get("sort") ?? "newest";
  const featuresRaw = url.searchParams.get("features") ?? "";
  const photos = url.searchParams.get("photos") === "1";
  const page = url.searchParams.get("page") ?? 1;
  const perPage = url.searchParams.get("perPage") ?? 100;

  if (mine) {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const listerPhoneNumber =
      typeof session?.user?.phoneNumber === "string" ? session.user.phoneNumber.trim() : "";
    if (!listerPhoneNumber) {
      return Response.json({ error: "Missing lister phone number" }, { status: 400 });
    }

    const perPageNumber = Math.max(1, Math.min(200, Number(perPage) || 100));
    const pageNumber = Math.max(1, Number(page) || 1);
    const skip = (pageNumber - 1) * perPageNumber;

    if (!process.env.MONGODB_URI) {
      return Response.json({
        listings: [],
        total: 0,
        page: pageNumber,
        perPage: perPageNumber,
      });
    }

    await dbConnect();
    const [total, listings] = await Promise.all([
      Listing.countDocuments({ listerPhoneNumber }),
      Listing.find({ listerPhoneNumber })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(perPageNumber),
    ]);

    return Response.json({
      listings: Array.isArray(listings) ? listings.map(serializeListing) : [],
      total: typeof total === "number" ? total : 0,
      page: pageNumber,
      perPage: perPageNumber,
    });
  }

  let isAdmin = false;
  if (includeAll) {
    try {
      const session = await getServerSession(authOptions);
      isAdmin = session?.user?.role === "admin";
    } catch { }
  }

  const features = featuresRaw
    ? featuresRaw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .slice(0, 12)
    : [];

  const result = await searchListings({
    status: includeAll && isAdmin ? "all" : "published",
    approvedOnly: !(includeAll && isAdmin),
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
    perPage,
  });

  return Response.json({
    listings: Array.isArray(result?.listings) ? result.listings : [],
    total: typeof result?.total === "number" ? result.total : 0,
    page: typeof result?.page === "number" ? result.page : 1,
    perPage: typeof result?.perPage === "number" ? result.perPage : 100,
  });
}

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.MONGODB_URI) {
    return Response.json(
      { error: "Listings are unavailable in demo mode" },
      { status: 503 },
    );
  }

  const listerPhoneNumber =
    typeof session?.user?.phoneNumber === "string" ? session.user.phoneNumber.trim() : "";
  const isAdmin = session?.user?.role === "admin";
  if (!listerPhoneNumber) {
    return Response.json({ error: "Missing lister phone number" }, { status: 400 });
  }

  const body = await request.json();
  const payload = normalizeListingPayload(body);
  const validationError = validateListingPayload(payload);
  if (validationError) {
    return Response.json({ error: validationError }, { status: 400 });
  }

  const now = new Date();

  await dbConnect();
  const actor = await User.findById(listerPhoneNumber).lean();
  const actorRole = actor?.role || session?.user?.role || "user";
  const isAgent = actorRole === "agent";
  const actorVerificationStatus = actor?.agentProfile?.verificationStatus || "none";
  const listingsFrozen = Boolean(actor?.agentProfile?.listingsFrozen);
  const canCreateAgentListing =
    isAgent && !listingsFrozen && actorVerificationStatus === "verified";
  const requestedListerType =
    payload.listerType === "agent" ||
      (payload.listerType !== "direct_landlord" && canCreateAgentListing)
      ? "agent"
      : "direct_landlord";
  if (requestedListerType === "agent" && !canCreateAgentListing) {
    return Response.json(
      {
        error:
          "Your agent profile is pending verification. New listings are frozen until admin approval.",
      },
      { status: 403 },
    );
  }

  let agentRate = null;
  let agentFixedFee = null;
  let agentProfileImageUrl = "";
  let listerType = "direct_landlord";
  let approved = isAdmin && typeof body?.approved === "boolean" ? body.approved : false;
  let approvalStatus = approved ? "approved" : "pending";
  let approvedByAdminId = approved ? listerPhoneNumber : "";
  let approvedAt = approved ? now : null;
  let approvalReason = approved ? "Approved by admin on create" : "Awaiting admin approval";

  if (requestedListerType === "agent") {
    listerType = "agent";
    approved = false;
    approvalStatus = "pending";
    approvedByAdminId = "";
    approvedAt = null;
    approvalReason = "Agent listing pending approval";
    agentRate =
      typeof actor?.agentProfile?.commissionRatePercent === "number"
        ? actor.agentProfile.commissionRatePercent
        : null;
    agentFixedFee =
      typeof actor?.agentProfile?.fixedFee === "number" ? actor.agentProfile.fixedFee : null;
    agentProfileImageUrl = String(actor?.agentProfile?.profileImageUrl || "").trim();
    if (agentRate === null && agentFixedFee === null) {
      return Response.json(
        { error: "Agent profile must have commission rate or fixed fee configured" },
        { status: 400 },
      );
    }

    const pricingSettings = await getPricingSettings({ ensurePersisted: true });
    const discountPercent = Number(pricingSettings?.agentPriceDiscountPercent ?? 0);
    const medianDirectPrice = await getMicroMarketMedianPrice({
      city: payload.city,
      suburb: payload.suburb,
    });
    if (Number.isFinite(medianDirectPrice)) {
      const maxAllowedAgentPrice = medianDirectPrice * (1 - discountPercent / 100);
      if (payload.pricePerMonth > maxAllowedAgentPrice) {
        return Response.json(
          {
            error: `Agent listing must be at least ${discountPercent}% below micro-market median (${medianDirectPrice.toFixed(2)}). Max allowed is ${maxAllowedAgentPrice.toFixed(2)}.`,
          },
          { status: 400 },
        );
      }
    }
  } else {
    listerType = "direct_landlord";
  }

  const listing = await Listing.create({
    title: payload.title,
    listerPhoneNumber,
    city: payload.city,
    suburb: payload.suburb,
    propertyCategory: payload.propertyCategory,
    propertyType: payload.propertyType,
    pricePerMonth: payload.pricePerMonth,
    deposit: payload.deposit,
    bedrooms: payload.bedrooms,
    description: payload.description,
    features: payload.features,
    images: payload.images,
    contactName:
      payload.contactName ||
      (typeof session?.user?.name === "string" ? session.user.name.trim() : "") ||
      "",
    contactPhone: payload.contactPhone || listerPhoneNumber,
    contactWhatsApp: payload.contactWhatsApp || listerPhoneNumber,
    contactEmail: payload.contactEmail,
    occupancy: payload.propertyCategory === "boarding" ? payload.occupancy : "",
    genderPreference: payload.propertyCategory === "boarding" ? payload.genderPreference : "",
    duration: payload.propertyCategory === "boarding" ? payload.duration : "",
    numberOfStudents:
      payload.propertyCategory === "boarding" ? payload.numberOfStudents : null,
    status: payload.status,
    approved,
    listerType,
    agentRate,
    agentFixedFee,
    agentProfileImageUrl,
    approvalStatus,
    approvedByAdminId,
    approvedAt,
    approvalReason,
    approvalHistory: [
      {
        status: approvalStatus,
        adminId: approvedByAdminId,
        reason: approvalReason,
        changedAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  });

  return Response.json({ listing: serializeListing(listing) }, { status: 201 });
}
