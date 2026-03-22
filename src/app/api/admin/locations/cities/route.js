import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbConnect, LocationCity } from "@/lib/db";
import { bumpLocationsVersion, getLocationsSnapshot, invalidateLocationsCache } from "@/lib/locations";

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
  const snapshot = await getLocationsSnapshot({ skipCache: true });
  return Response.json({ version: snapshot.version, cities: snapshot.cities });
}

export async function POST(request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const cityName = normalizeName(body?.city_name || body?.cityName);
  if (!cityName) {
    return Response.json({ error: "City name is required" }, { status: 400 });
  }
  const cityId = toSlug(body?.city_id || body?.cityId || cityName);
  if (!cityId) {
    return Response.json({ error: "City ID is invalid" }, { status: 400 });
  }

  await dbConnect();

  const duplicateByName = await LocationCity.findOne({
    cityNameLower: cityName.toLowerCase(),
  })
    .lean()
    .exec();
  if (duplicateByName) {
    return Response.json({ error: "City already exists" }, { status: 409 });
  }

  const duplicateById = await LocationCity.findOne({ cityId }).lean().exec();
  if (duplicateById) {
    return Response.json({ error: "City ID already exists" }, { status: 409 });
  }

  const created = await LocationCity.create({
    cityId,
    cityName,
    cityNameLower: cityName.toLowerCase(),
  });

  await bumpLocationsVersion();
  invalidateLocationsCache();

  return Response.json(
    {
      ok: true,
      city: {
        city_id: created.cityId,
        city_name: created.cityName,
      },
    },
    { status: 201 },
  );
}
