import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbConnect, LocationCity, LocationSuburb } from "@/lib/db";
import { bumpLocationsVersion, invalidateLocationsCache } from "@/lib/locations";

export const runtime = "nodejs";

function normalizeName(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  return Boolean(session?.user && session.user.role === "admin");
}

export async function GET(_request, { params }) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const suburbId = normalizeName(params?.suburbId).toLowerCase();
  await dbConnect();
  const suburb = await LocationSuburb.findOne({ suburbId }).lean().exec();
  if (!suburb) {
    return Response.json({ error: "Suburb not found" }, { status: 404 });
  }
  const city = await LocationCity.findOne({ cityId: suburb.cityId }, { cityName: 1, _id: 0 }).lean().exec();
  return Response.json({
    suburb: {
      suburb_id: suburb.suburbId,
      suburb_name: suburb.suburbName,
      city_id: suburb.cityId,
      city_name: city?.cityName || "",
      active: suburb.active !== false,
    },
  });
}

export async function PATCH(request, { params }) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const suburbId = normalizeName(params?.suburbId).toLowerCase();
  const body = await request.json().catch(() => ({}));
  const suburbName = normalizeName(body?.suburb_name || body?.suburbName);
  const cityId = normalizeName(body?.city_id || body?.cityId).toLowerCase();
  const hasSuburbName = typeof body?.suburb_name === "string" || typeof body?.suburbName === "string";
  const hasCityId = typeof body?.city_id === "string" || typeof body?.cityId === "string";
  const hasActive = typeof body?.active === "boolean";
  if (!hasSuburbName && !hasCityId && !hasActive) {
    return Response.json({ error: "Provide suburb_name, city_id, or active" }, { status: 400 });
  }
  if (hasSuburbName && !suburbName) {
    return Response.json({ error: "Suburb name is required" }, { status: 400 });
  }
  if (hasCityId && !cityId) {
    return Response.json({ error: "City ID is required" }, { status: 400 });
  }

  await dbConnect();
  const suburb = await LocationSuburb.findOne({ suburbId }).exec();
  if (!suburb) {
    return Response.json({ error: "Suburb not found" }, { status: 404 });
  }
  let city = await LocationCity.findOne({ cityId: suburb.cityId }).lean().exec();
  if (hasCityId || hasSuburbName) {
    const targetCityId = hasCityId ? cityId : suburb.cityId;
    city = await LocationCity.findOne({ cityId: targetCityId }).lean().exec();
    if (!city?._id) {
      return Response.json({ error: "City not found" }, { status: 404 });
    }
    const duplicate = await LocationSuburb.findOne({
      cityId: targetCityId,
      suburbNameLower: (hasSuburbName ? suburbName : suburb.suburbName).toLowerCase(),
      suburbId: { $ne: suburbId },
    })
      .lean()
      .exec();
    if (duplicate) {
      return Response.json({ error: "Suburb already exists in this city" }, { status: 409 });
    }
  }

  if (hasSuburbName) {
    suburb.suburbName = suburbName;
    suburb.suburbNameLower = suburbName.toLowerCase();
  }
  if (hasCityId && city?._id) {
    suburb.cityId = cityId;
    suburb.cityRef = city._id;
  }
  if (hasActive) {
    suburb.active = body.active;
  }
  await suburb.save();

  await bumpLocationsVersion();
  invalidateLocationsCache();

  return Response.json({
    ok: true,
    suburb: {
      suburb_id: suburb.suburbId,
      suburb_name: suburb.suburbName,
      city_id: suburb.cityId,
      city_name: city?.cityName || "",
      active: suburb.active !== false,
    },
  });
}

export async function DELETE(_request, { params }) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const suburbId = normalizeName(params?.suburbId).toLowerCase();
  await dbConnect();
  const suburb = await LocationSuburb.findOne({ suburbId }).lean().exec();
  if (!suburb) {
    return Response.json({ error: "Suburb not found" }, { status: 404 });
  }
  await LocationSuburb.deleteOne({ suburbId });
  await bumpLocationsVersion();
  invalidateLocationsCache();
  return Response.json({ ok: true });
}
