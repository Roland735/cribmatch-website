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
  const cityId = normalizeName(params?.cityId).toLowerCase();
  await dbConnect();
  const city = await LocationCity.findOne({ cityId }, { cityId: 1, cityName: 1, _id: 1 }).lean().exec();
  if (!city) {
    return Response.json({ error: "City not found" }, { status: 404 });
  }
  const suburbs = await LocationSuburb.find(
    { cityId },
    { suburbId: 1, suburbName: 1, cityId: 1, _id: 1 },
  )
    .sort({ suburbNameLower: 1 })
    .lean()
    .exec();
  return Response.json({
    city: { city_id: city.cityId, city_name: city.cityName },
    suburbs: suburbs.map((suburb) => ({
      suburb_id: suburb.suburbId,
      suburb_name: suburb.suburbName,
      city_id: suburb.cityId,
    })),
  });
}

export async function PATCH(request, { params }) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const cityId = normalizeName(params?.cityId).toLowerCase();
  const body = await request.json().catch(() => ({}));
  const cityName = normalizeName(body?.city_name || body?.cityName);
  if (!cityName) {
    return Response.json({ error: "City name is required" }, { status: 400 });
  }

  await dbConnect();
  const existing = await LocationCity.findOne({ cityId }).exec();
  if (!existing) {
    return Response.json({ error: "City not found" }, { status: 404 });
  }

  const duplicate = await LocationCity.findOne({
    cityNameLower: cityName.toLowerCase(),
    cityId: { $ne: cityId },
  })
    .lean()
    .exec();
  if (duplicate) {
    return Response.json({ error: "City already exists" }, { status: 409 });
  }

  existing.cityName = cityName;
  existing.cityNameLower = cityName.toLowerCase();
  await existing.save();
  await bumpLocationsVersion();
  invalidateLocationsCache();

  return Response.json({
    ok: true,
    city: {
      city_id: existing.cityId,
      city_name: existing.cityName,
    },
  });
}

export async function DELETE(_request, { params }) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const cityId = normalizeName(params?.cityId).toLowerCase();
  await dbConnect();
  const city = await LocationCity.findOne({ cityId }).lean().exec();
  if (!city) {
    return Response.json({ error: "City not found" }, { status: 404 });
  }
  const suburbCount = await LocationSuburb.countDocuments({ cityId });
  if (suburbCount > 0) {
    return Response.json({ error: "Delete suburbs for this city first" }, { status: 409 });
  }
  await LocationCity.deleteOne({ cityId });
  await bumpLocationsVersion();
  invalidateLocationsCache();
  return Response.json({ ok: true });
}
