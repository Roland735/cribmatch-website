import { getServerSession } from "next-auth";
import { authOptions, normalizePhoneNumber } from "@/lib/auth";
import { dbConnect, Listing, User } from "@/lib/db";

export const runtime = "nodejs";

function uniqueContacts(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "admin") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  await dbConnect();

  const [admin, users, listingRows] = await Promise.all([
    User.findById(session.user.phoneNumber).lean(),
    User.find().select("_id name role createdAt").sort({ createdAt: -1 }).limit(500).lean(),
    Listing.find()
      .select("title city suburb contactPhone contactWhatsApp contactEmail createdAt")
      .sort({ createdAt: -1 })
      .limit(500)
      .lean(),
  ]);

  const normalizedUsers = users.map((item) => ({
    phoneNumber: item._id,
    name: item.name || "",
    role: item.role || "user",
    createdAt: item.createdAt || null,
  }));

  const listingContacts = listingRows.map((item) => ({
    listingTitle: item.title || "",
    city: item.city || "",
    suburb: item.suburb || "",
    phones: uniqueContacts([item.contactPhone, item.contactWhatsApp]),
    email: item.contactEmail || "",
    createdAt: item.createdAt || null,
  }));

  return Response.json({
    adminContactNumber: admin?.adminContactNumber || "",
    users: normalizedUsers,
    listings: listingContacts,
  });
}

export async function PATCH(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "admin") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const rawContact = typeof body?.adminContactNumber === "string" ? body.adminContactNumber : "";
  const adminContactNumber = normalizePhoneNumber(rawContact);
  if (!adminContactNumber) {
    return Response.json({ error: "Enter a valid contact number." }, { status: 400 });
  }

  await dbConnect();
  const updated = await User.findByIdAndUpdate(
    session.user.phoneNumber,
    { $set: { adminContactNumber } },
    { new: true, upsert: false },
  ).lean();

  if (!updated) {
    return Response.json({ error: "Admin account not found." }, { status: 404 });
  }

  return Response.json({ ok: true, adminContactNumber: updated.adminContactNumber || "" });
}
