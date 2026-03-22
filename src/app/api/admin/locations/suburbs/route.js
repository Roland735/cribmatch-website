import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbConnect, LocationCity, LocationSuburb } from "@/lib/db";
import { bumpLocationsVersion, invalidateLocationsCache } from "@/lib/locations";

export const runtime = "nodejs";

function normalizeName(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function toSlug(value) {
  return normalizeName(value)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  return Boolean(session?.user && session.user.role === "admin");
}

export async function GET() {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  await dbConnect();
  const rows = await LocationSuburb.find(
    {},
    { suburbId: 1, suburbName: 1, cityId: 1, active: 1, _id: 0 },
  )
    .sort({ cityId: 1, suburbNameLower: 1 })
    .lean()
    .exec();
  const cityIds = Array.from(new Set((rows || []).map((item) => item?.cityId).filter(Boolean)));
  const cityRows = await LocationCity.find(
    { cityId: { $in: cityIds } },
    { cityId: 1, cityName: 1, _id: 0 },
  )
    .lean()
    .exec();
  const cityNameById = new Map((cityRows || []).map((city) => [city.cityId, city.cityName]));
  return Response.json({
    suburbs: (Array.isArray(rows) ? rows : []).map((suburb) => ({
      suburb_id: suburb.suburbId,
      suburb_name: suburb.suburbName,
      city_id: suburb.cityId,
      city_name: cityNameById.get(suburb.cityId) || "",
      active: suburb.active !== false,
    })),
  });
}

export async function POST(request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const cityId = normalizeName(body?.city_id || body?.cityId).toLowerCase();
  const suburbName = normalizeName(body?.suburb_name || body?.suburbName);
  const active = body?.active !== false;
  if (!cityId) {
    return Response.json({ error: "City ID is required" }, { status: 400 });
  }
  if (!suburbName) {
    return Response.json({ error: "Suburb name is required" }, { status: 400 });
  }
  const suburbId = toSlug(body?.suburb_id || body?.suburbId || `${suburbName}_${cityId}`);
  if (!suburbId) {
    return Response.json({ error: "Suburb ID is invalid" }, { status: 400 });
  }

  await dbConnect();
  const city = await LocationCity.findOne({ cityId }).lean().exec();
  if (!city?._id) {
    return Response.json({ error: "City not found" }, { status: 404 });
  }

  const duplicateByName = await LocationSuburb.findOne({
    cityId,
    suburbNameLower: suburbName.toLowerCase(),
  })
    .lean()
    .exec();
  if (duplicateByName) {
    return Response.json({ error: "Suburb already exists in this city" }, { status: 409 });
  }

  const duplicateById = await LocationSuburb.findOne({ suburbId }).lean().exec();
  if (duplicateById) {
    return Response.json({ error: "Suburb ID already exists" }, { status: 409 });
  }

  const created = await LocationSuburb.create({
    suburbId,
    suburbName,
    suburbNameLower: suburbName.toLowerCase(),
    cityId,
    cityRef: city._id,
    active,
  });

  await bumpLocationsVersion();
  invalidateLocationsCache();

  return Response.json(
    {
      ok: true,
      suburb: {
        suburb_id: created.suburbId,
        suburb_name: created.suburbName,
        city_id: created.cityId,
        city_name: city.cityName,
        active: created.active !== false,
      },
    },
    { status: 201 },
  );
}
