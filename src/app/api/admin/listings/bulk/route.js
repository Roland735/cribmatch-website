import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbConnect, Listing } from "@/lib/db";

export const runtime = "nodejs";

export async function PATCH(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session?.user?.role !== "admin") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { ids, action, data } = body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return Response.json({ error: "Missing listing IDs" }, { status: 400 });
  }

  await dbConnect();

  let update = {};
  if (action === "approve") {
    update = { approved: true };
  } else if (action === "unapprove") {
    update = { approved: false };
  } else if (action === "publish") {
    update = { status: "published" };
  } else if (action === "draft") {
    update = { status: "draft" };
  } else if (action === "archive") {
    update = { status: "archived" };
  } else if (action === "mark_marketed") {
    update = { marketed: true, marketedAt: new Date() };
  } else if (action === "delete") {
    await Listing.deleteMany({ _id: { $in: ids } });
    return Response.json({ ok: true, deletedCount: ids.length });
  } else if (action === "update" && data) {
    update = data;
  } else {
    return Response.json({ error: "Invalid action" }, { status: 400 });
  }

  const result = await Listing.updateMany(
    { _id: { $in: ids } },
    { $set: { ...update, updatedAt: new Date() } }
  );

  return Response.json({ ok: true, modifiedCount: result.modifiedCount });
}
