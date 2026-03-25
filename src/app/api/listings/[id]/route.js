import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbConnect, getPricingSettings, Listing } from "@/lib/db";
import {
  KNOWN_PROPERTY_CATEGORIES,
  KNOWN_PROPERTY_TYPES_BY_CATEGORY,
} from "@/lib/getListings";
import seedListings from "@/lib/seedListings.json";

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
  if (numbers.length % 2 === 0) return (numbers[middle - 1] + numbers[middle]) / 2;
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
    return normalizeMarketValue(listing?.suburb) === suburbNorm;
  });
  if (bySuburb.length) return computeMedian(bySuburb.map((listing) => listing?.pricePerMonth));
  const byCity = directListings.filter((listing) => {
    if (!cityNorm) return false;
    return normalizeMarketValue(listing?.city) === cityNorm;
  });
  if (byCity.length) return computeMedian(byCity.map((listing) => listing?.pricePerMonth));
  return computeMedian(directListings.map((listing) => listing?.pricePerMonth));
}

export async function GET(_request, { params }) {
  const { id } = await params;
  if (!process.env.MONGODB_URI) {
    const listing = seedListings.find((item) => item?._id === id);
    if (!listing) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json({ listing });
  }

  await dbConnect();
  const listing = await Listing.findById(id);

  if (!listing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({ listing: serializeListing(listing) });
}

export async function PATCH(request, { params }) {
  const { id } = await params;
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

  const body = await request.json();
  const hasAgentRate = Object.prototype.hasOwnProperty.call(body || {}, "agentRate");
  const hasAgentFixedFee = Object.prototype.hasOwnProperty.call(body || {}, "agentFixedFee");
  if (body?.listerType || body?.lister_type) {
    return Response.json({ error: "lister_type cannot be changed after creation" }, { status: 400 });
  }
  await dbConnect();
  const existing = await Listing.findById(id);
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const actorPhoneNumber =
    typeof session?.user?.phoneNumber === "string" ? session.user.phoneNumber.trim() : "";
  const isAdmin = session?.user?.role === "admin";
  const isOwner = Boolean(actorPhoneNumber) && existing.listerPhoneNumber === actorPhoneNumber;
  if (!isAdmin && !isOwner) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin && typeof body?.approved === "boolean") {
    return Response.json({ error: "Only admins can approve or reject listings" }, { status: 403 });
  }
  if (!isAdmin && (hasAgentRate || hasAgentFixedFee)) {
    return Response.json({ error: "Only admins can update agent fees" }, { status: 403 });
  }
  if ((hasAgentRate || hasAgentFixedFee) && existing?.listerType !== "agent") {
    return Response.json({ error: "Agent fees can only be set for agent listings" }, { status: 400 });
  }

  const update = {};
  const now = new Date();
  if (isAdmin && typeof body?.approved === "boolean") {
    update.approved = body.approved;
    update.approvalStatus = body.approved ? "approved" : "rejected";
    update.approvedByAdminId = actorPhoneNumber;
    update.approvedAt = body.approved ? now : null;
    update.approvalReason =
      typeof body?.approvalReason === "string" && body.approvalReason.trim()
        ? body.approvalReason.trim()
        : body.approved
          ? "Approved by admin"
          : "Rejected by admin";
    update.$push = {
      approvalHistory: {
        status: update.approvalStatus,
        adminId: actorPhoneNumber,
        reason: update.approvalReason,
        changedAt: now,
      },
    };
  }
  const propertyCategoryRaw =
    typeof body?.propertyCategory === "string" ? body.propertyCategory.trim() : "";
  const propertyTypeRaw =
    typeof body?.propertyType === "string" ? body.propertyType.trim() : "";

  const nextCategory = propertyCategoryRaw
    ? KNOWN_PROPERTY_CATEGORIES.includes(propertyCategoryRaw)
      ? propertyCategoryRaw
      : null
    : existing.propertyCategory;
  if (!nextCategory) {
    return Response.json({ error: "Invalid property category" }, { status: 400 });
  }

  let nextType = propertyTypeRaw || existing.propertyType;
  if (nextCategory === "commercial" && nextType === "Retail") {
    nextType = "Retail warehouse";
  }
  if (propertyCategoryRaw && !propertyTypeRaw) {
    const allowed = KNOWN_PROPERTY_TYPES_BY_CATEGORY[nextCategory] || [];
    nextType = allowed[0] || "";
  }

  if (propertyCategoryRaw) update.propertyCategory = nextCategory;
  if (propertyTypeRaw || propertyCategoryRaw) {
    const allowed = KNOWN_PROPERTY_TYPES_BY_CATEGORY[nextCategory] || [];
    if (!nextType || !allowed.includes(nextType)) {
      return Response.json(
        { error: "Invalid property type for category" },
        { status: 400 },
      );
    }
    update.propertyType = nextType;
  }

  if (typeof body?.title === "string") update.title = body.title.trim();
  if (typeof body?.city === "string") update.city = body.city.trim();
  if (typeof body?.suburb === "string") update.suburb = body.suburb.trim();
  if (typeof body?.pricePerMonth === "number") update.pricePerMonth = body.pricePerMonth;
  if (typeof body?.deposit === "number") update.deposit = body.deposit;
  if (typeof body?.bedrooms === "number") update.bedrooms = body.bedrooms;
  if (typeof body?.description === "string")
    update.description = body.description.trim();
  if (Array.isArray(body?.features)) {
    update.features = body.features
      .filter((f) => typeof f === "string" && f.trim())
      .slice(0, 12);
  }
  if (Array.isArray(body?.images)) {
    update.images = body.images
      .filter((url) => typeof url === "string" && url.trim())
      .slice(0, 12);
  }
  if (typeof body?.contactName === "string")
    update.contactName = body.contactName.trim();
  if (typeof body?.contactPhone === "string")
    update.contactPhone = body.contactPhone.trim();
  if (typeof body?.contactWhatsApp === "string")
    update.contactWhatsApp = body.contactWhatsApp.trim();
  if (typeof body?.contactEmail === "string")
    update.contactEmail = body.contactEmail.trim();
  if (typeof body?.occupancy === "string") update.occupancy = body.occupancy.trim();
  if (typeof body?.genderPreference === "string")
    update.genderPreference = body.genderPreference.trim();
  if (typeof body?.duration === "string") update.duration = body.duration.trim();
  if (typeof body?.numberOfStudents === "number")
    update.numberOfStudents = Math.floor(body.numberOfStudents);
  if (body?.status === "draft" || body?.status === "published" || body?.status === "archived") {
    update.status = body.status;
  }
  if (isAdmin && typeof body?.marketed === "boolean") {
    update.marketed = body.marketed;
    update.marketedAt = body.marketed ? new Date() : null;
  }
  if (isAdmin && hasAgentRate) {
    if (body?.agentRate === null) {
      update.agentRate = null;
    } else if (typeof body?.agentRate === "number" && Number.isFinite(body.agentRate) && body.agentRate >= 0 && body.agentRate <= 100) {
      update.agentRate = body.agentRate;
    } else {
      return Response.json({ error: "Agent rate must be a number between 0 and 100" }, { status: 400 });
    }
  }
  if (isAdmin && hasAgentFixedFee) {
    if (body?.agentFixedFee === null) {
      update.agentFixedFee = null;
    } else if (typeof body?.agentFixedFee === "number" && Number.isFinite(body.agentFixedFee) && body.agentFixedFee >= 0) {
      update.agentFixedFee = body.agentFixedFee;
    } else {
      return Response.json({ error: "Agent fixed fee must be a non-negative number" }, { status: 400 });
    }
  }
  if (
    isAdmin &&
    hasAgentRate &&
    hasAgentFixedFee &&
    update.agentRate !== null &&
    update.agentFixedFee !== null
  ) {
    return Response.json({ error: "Choose either percentage fee or fixed fee, not both" }, { status: 400 });
  }
  if (isAdmin && (hasAgentRate || hasAgentFixedFee) && existing?.listerType === "agent") {
    const nextAgentRate = update.agentRate !== undefined ? update.agentRate : toValidNumber(existing.agentRate);
    const nextAgentFixedFee =
      update.agentFixedFee !== undefined ? update.agentFixedFee : toValidNumber(existing.agentFixedFee);
    if (nextAgentRate === null && nextAgentFixedFee === null) {
      return Response.json(
        { error: "Agent listings require either a percentage fee or fixed fee" },
        { status: 400 },
      );
    }
  }

  const hasListingFieldChanges =
    propertyCategoryRaw ||
    propertyTypeRaw ||
    typeof body?.title === "string" ||
    typeof body?.city === "string" ||
    typeof body?.suburb === "string" ||
    typeof body?.pricePerMonth === "number" ||
    typeof body?.deposit === "number" ||
    typeof body?.bedrooms === "number" ||
    typeof body?.description === "string" ||
    Array.isArray(body?.features) ||
    Array.isArray(body?.images) ||
    typeof body?.contactName === "string" ||
    typeof body?.contactPhone === "string" ||
    typeof body?.contactWhatsApp === "string" ||
    typeof body?.contactEmail === "string" ||
    typeof body?.occupancy === "string" ||
    typeof body?.genderPreference === "string" ||
    typeof body?.duration === "string" ||
    typeof body?.numberOfStudents === "number";

  if (!hasListingFieldChanges) {
    update.updatedAt = now;
    const moderated = await Listing.findByIdAndUpdate(id, update, { new: true });
    if (!moderated) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json({ listing: serializeListing(moderated) });
  }

  const nextCategoryValidated = typeof update.propertyCategory === "string" ? update.propertyCategory : existing.propertyCategory;
  const nextAllowedTypes = KNOWN_PROPERTY_TYPES_BY_CATEGORY[nextCategoryValidated] || [];
  const nextTypeValidated = typeof update.propertyType === "string" ? update.propertyType : existing.propertyType;
  if (!nextTypeValidated || !nextAllowedTypes.includes(nextTypeValidated)) {
    return Response.json(
      { error: "Invalid property type for category" },
      { status: 400 },
    );
  }

  const nextTitle = typeof update.title === "string" ? update.title : existing.title;
  const nextCity = typeof update.city === "string" ? update.city : existing.city;
  const nextSuburb = typeof update.suburb === "string" ? update.suburb : existing.suburb;
  const nextPrice = update.pricePerMonth !== undefined ? toValidNumber(update.pricePerMonth) : toValidNumber(existing.pricePerMonth);
  const nextDeposit = update.deposit !== undefined ? toValidNumber(update.deposit) : toValidNumber(existing.deposit);
  const nextBedrooms = update.bedrooms !== undefined ? toValidNumber(update.bedrooms) : toValidNumber(existing.bedrooms);
  const nextOccupancy = typeof update.occupancy === "string" ? update.occupancy : existing.occupancy;
  const nextGenderPreference =
    typeof update.genderPreference === "string" ? update.genderPreference : existing.genderPreference;
  const nextDuration = typeof update.duration === "string" ? update.duration : existing.duration;
  const nextNumberOfStudents =
    update.numberOfStudents !== undefined
      ? toValidNumber(update.numberOfStudents)
      : toValidNumber(existing.numberOfStudents);

  if (!String(nextTitle || "").trim() || !String(nextCity || "").trim() || !String(nextSuburb || "").trim()) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (nextPrice === null || nextPrice < 0) {
    return Response.json({ error: "Price per month must be a non-negative number" }, { status: 400 });
  }
  if (nextDeposit !== null && nextDeposit < 0) {
    return Response.json({ error: "Deposit must be a non-negative number" }, { status: 400 });
  }
  if (nextBedrooms === null || nextBedrooms < 0) {
    return Response.json({ error: "Bedrooms must be a non-negative number" }, { status: 400 });
  }
  if (nextCategoryValidated === "boarding") {
    if (!String(nextOccupancy || "").trim() || !String(nextGenderPreference || "").trim() || !String(nextDuration || "").trim()) {
      return Response.json(
        { error: "Boarding listings require occupancy, gender preference, and duration" },
        { status: 400 },
      );
    }
    if (nextNumberOfStudents === null || nextNumberOfStudents <= 0) {
      return Response.json(
        { error: "Boarding listings require number of students greater than zero" },
        { status: 400 },
      );
    }
  } else {
    if (update.occupancy === undefined) update.occupancy = "";
    if (update.genderPreference === undefined) update.genderPreference = "";
    if (update.duration === undefined) update.duration = "";
    if (update.numberOfStudents === undefined) update.numberOfStudents = null;
  }

  if (existing?.listerType === "agent" && typeof nextPrice === "number") {
    const pricingSettings = await getPricingSettings({ ensurePersisted: true });
    const discountPercent = Number(pricingSettings?.agentPriceDiscountPercent ?? 0);
    const medianDirectPrice = await getMicroMarketMedianPrice({
      city: nextCity,
      suburb: nextSuburb,
    });
    if (Number.isFinite(medianDirectPrice)) {
      const maxAllowedAgentPrice = medianDirectPrice * (1 - discountPercent / 100);
      if (nextPrice > maxAllowedAgentPrice) {
        return Response.json(
          {
            error: `Agent listing must be at least ${discountPercent}% below micro-market median (${medianDirectPrice.toFixed(2)}). Max allowed is ${maxAllowedAgentPrice.toFixed(2)}.`,
          },
          { status: 400 },
        );
      }
    }
  }

  update.updatedAt = now;

  const listing = await Listing.findByIdAndUpdate(id, update, {
    new: true,
  });

  if (!listing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({ listing: serializeListing(listing) });
}

export async function DELETE(_request, { params }) {
  const { id } = await params;
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

  await dbConnect();
  const existing = await Listing.findById(id);
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

  const actorPhoneNumber =
    typeof session?.user?.phoneNumber === "string" ? session.user.phoneNumber.trim() : "";
  const isAdmin = session?.user?.role === "admin";
  const isOwner = Boolean(actorPhoneNumber) && existing.listerPhoneNumber === actorPhoneNumber;
  if (!isAdmin && !isOwner) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await Listing.findByIdAndDelete(id);
  if (!result) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}
