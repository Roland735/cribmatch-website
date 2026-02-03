import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbConnect, Listing } from "@/lib/db";
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
    createdAt: obj?.createdAt?.toISOString?.() ?? obj?.createdAt,
    updatedAt: obj?.updatedAt?.toISOString?.() ?? obj?.updatedAt,
  };
}

export async function GET(_request, { params }) {
  if (!process.env.MONGODB_URI) {
    const listing = seedListings.find((item) => item?._id === params?.id);
    if (!listing) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json({ listing });
  }

  await dbConnect();
  const listing = await Listing.findById(params?.id);

  if (!listing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({ listing: serializeListing(listing) });
}

export async function PATCH(request, { params }) {
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
  await dbConnect();
  const existing = await Listing.findById(params?.id);
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

  const update = {};
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
  if (typeof body?.suburb === "string") update.suburb = body.suburb.trim();
  if (typeof body?.pricePerMonth === "number")
    update.pricePerMonth = body.pricePerMonth;
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
  if (body?.status === "draft" || body?.status === "published") {
    update.status = body.status;
  }

  update.updatedAt = new Date();

  const listing = await Listing.findByIdAndUpdate(params?.id, update, {
    new: true,
  });

  if (!listing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({ listing: serializeListing(listing) });
}

export async function DELETE(_request, { params }) {
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
  const existing = await Listing.findById(params?.id);
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

  const actorPhoneNumber =
    typeof session?.user?.phoneNumber === "string" ? session.user.phoneNumber.trim() : "";
  const isAdmin = session?.user?.role === "admin";
  const isOwner = Boolean(actorPhoneNumber) && existing.listerPhoneNumber === actorPhoneNumber;
  if (!isAdmin && !isOwner) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await Listing.findByIdAndDelete(params?.id);
  if (!result) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}
