import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbConnect, LocationCity, LocationSuburb } from "@/lib/db";
import { bumpLocationsVersion, invalidateLocationsCache } from "@/lib/locations";

export const runtime = "nodejs";

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  return Boolean(session?.user && session.user.role === "admin");
}

export async function POST(request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const target = String(body?.target || "").trim().toLowerCase();
  const action = String(body?.action || "").trim().toLowerCase();
  const ids = toStringArray(body?.ids);

  if (!["cities", "suburbs"].includes(target)) {
    return Response.json({ error: "Invalid target" }, { status: 400 });
  }
  if (!["activate", "deactivate", "delete", "harare_only"].includes(action)) {
    return Response.json({ error: "Invalid action" }, { status: 400 });
  }
  if (action !== "harare_only" && !ids.length) {
    return Response.json({ error: "Select at least one item" }, { status: 400 });
  }

  await dbConnect();
  let result = { modifiedCount: 0, deletedCount: 0 };

  if (target === "cities") {
    if (action === "activate") {
      result = await LocationCity.updateMany({ cityId: { $in: ids } }, { $set: { active: true } });
    } else if (action === "deactivate") {
      result = await LocationCity.updateMany({ cityId: { $in: ids } }, { $set: { active: false } });
      await LocationSuburb.updateMany({ cityId: { $in: ids } }, { $set: { active: false } });
    } else if (action === "delete") {
      const suburbCount = await LocationSuburb.countDocuments({ cityId: { $in: ids } });
      if (suburbCount > 0) {
        return Response.json({ error: "Delete selected suburbs first" }, { status: 409 });
      }
      result = await LocationCity.deleteMany({ cityId: { $in: ids } });
    } else if (action === "harare_only") {
      await LocationCity.updateMany({ cityId: "harare" }, { $set: { active: true } });
      await LocationCity.updateMany({ cityId: { $ne: "harare" } }, { $set: { active: false } });
      await LocationSuburb.updateMany({ cityId: "harare" }, { $set: { active: true } });
      await LocationSuburb.updateMany({ cityId: { $ne: "harare" } }, { $set: { active: false } });
      result = { modifiedCount: 1, deletedCount: 0 };
    }
  }

  if (target === "suburbs") {
    if (action === "activate") {
      result = await LocationSuburb.updateMany({ suburbId: { $in: ids } }, { $set: { active: true } });
    } else if (action === "deactivate") {
      result = await LocationSuburb.updateMany({ suburbId: { $in: ids } }, { $set: { active: false } });
    } else if (action === "delete") {
      result = await LocationSuburb.deleteMany({ suburbId: { $in: ids } });
    } else if (action === "harare_only") {
      await LocationSuburb.updateMany({ cityId: "harare" }, { $set: { active: true } });
      await LocationSuburb.updateMany({ cityId: { $ne: "harare" } }, { $set: { active: false } });
      result = { modifiedCount: 1, deletedCount: 0 };
    }
  }

  await bumpLocationsVersion();
  invalidateLocationsCache();

  return Response.json({
    ok: true,
    modifiedCount: Number(result?.modifiedCount || result?.matchedCount || 0),
    deletedCount: Number(result?.deletedCount || 0),
  });
}
