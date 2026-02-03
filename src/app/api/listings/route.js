import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbConnect, Listing } from "@/lib/db";
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
    createdAt: obj?.createdAt?.toISOString?.() ?? obj?.createdAt,
    updatedAt: obj?.updatedAt?.toISOString?.() ?? obj?.updatedAt,
  };
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
  if (!listerPhoneNumber) {
    return Response.json({ error: "Missing lister phone number" }, { status: 400 });
  }

  const body = await request.json();
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const suburb = typeof body?.suburb === "string" ? body.suburb.trim() : "";
  const propertyCategoryRaw =
    typeof body?.propertyCategory === "string" ? body.propertyCategory.trim() : "";
  const propertyCategory = propertyCategoryRaw
    ? KNOWN_PROPERTY_CATEGORIES.includes(propertyCategoryRaw)
      ? propertyCategoryRaw
      : null
    : "residential";
  if (!propertyCategory) {
    return Response.json({ error: "Invalid property category" }, { status: 400 });
  }
  const propertyType =
    typeof body?.propertyType === "string" ? body.propertyType.trim() : "";
  const normalizedPropertyType =
    propertyCategory === "commercial" && propertyType === "Retail"
      ? "Retail warehouse"
      : propertyType;
  const allowedTypes = KNOWN_PROPERTY_TYPES_BY_CATEGORY[propertyCategory] || [];
  if (!normalizedPropertyType || !allowedTypes.includes(normalizedPropertyType)) {
    return Response.json(
      { error: "Invalid property type for category" },
      { status: 400 },
    );
  }
  const pricePerMonth =
    typeof body?.pricePerMonth === "number" ? body.pricePerMonth : null;
  const deposit = typeof body?.deposit === "number" ? body.deposit : null;
  const bedrooms = typeof body?.bedrooms === "number" ? body.bedrooms : null;
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
  const status = body?.status === "draft" ? "draft" : "published";

  if (!title || !suburb || pricePerMonth === null || bedrooms === null) {
    return Response.json(
      { error: "Missing required fields" },
      { status: 400 },
    );
  }

  const now = new Date();

  await dbConnect();

  const listing = await Listing.create({
    title,
    listerPhoneNumber,
    suburb,
    propertyCategory,
    propertyType: normalizedPropertyType,
    pricePerMonth,
    deposit,
    bedrooms,
    description,
    features,
    images,
    contactName:
      contactName ||
      (typeof session?.user?.name === "string" ? session.user.name.trim() : "") ||
      "",
    contactPhone: contactPhone || listerPhoneNumber,
    contactWhatsApp: contactWhatsApp || listerPhoneNumber,
    contactEmail,
    status,
    createdAt: now,
    updatedAt: now,
  });

  return Response.json({ listing: serializeListing(listing) }, { status: 201 });
}
