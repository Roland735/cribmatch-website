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
  if (!suburbName) {
    return Response.json({ error: "Suburb name is required" }, { status: 400 });
  }
  if (!cityId) {
    return Response.json({ error: "City ID is required" }, { status: 400 });
  }

  await dbConnect();
  const suburb = await LocationSuburb.findOne({ suburbId }).exec();
  if (!suburb) {
    return Response.json({ error: "Suburb not found" }, { status: 404 });
  }
  const city = await LocationCity.findOne({ cityId }).lean().exec();
  if (!city?._id) {
    return Response.json({ error: "City not found" }, { status: 404 });
  }

  const duplicate = await LocationSuburb.findOne({
    cityId,
    suburbNameLower: suburbName.toLowerCase(),
    suburbId: { $ne: suburbId },
  })
    .lean()
    .exec();
  if (duplicate) {
    return Response.json({ error: "Suburb already exists in this city" }, { status: 409 });
  }

  suburb.suburbName = suburbName;
  suburb.suburbNameLower = suburbName.toLowerCase();
  suburb.cityId = cityId;
  suburb.cityRef = city._id;
  await suburb.save();

  await bumpLocationsVersion();
  invalidateLocationsCache();

  return Response.json({
    ok: true,
    suburb: {
      suburb_id: suburb.suburbId,
      suburb_name: suburb.suburbName,
      city_id: suburb.cityId,
      city_name: city.cityName,
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
