import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbConnect, Listing, Purchase } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const listerPhoneNumber =
    typeof session?.user?.phoneNumber === "string" ? session.user.phoneNumber.trim() : "";
  if (!listerPhoneNumber) {
    return Response.json({ error: "Missing lister phone number" }, { status: 400 });
  }

  await dbConnect();

  const listings = await Listing.find(
    { listerPhoneNumber },
    { _id: 1, approved: 1, status: 1, title: 1 },
  ).lean();

  const listingIds = listings.map((listing) => String(listing?._id || "")).filter(Boolean);
  const listingTitleById = listings.reduce((acc, listing) => {
    const id = String(listing?._id || "");
    if (!id) return acc;
    acc[id] = typeof listing?.title === "string" ? listing.title : "Listing";
    return acc;
  }, {});

  const [
    pendingApproval,
    activeListings,
    deactivatedListings,
    totalPurchases,
    recentPurchasesRaw,
  ] = await Promise.all([
    Listing.countDocuments({ listerPhoneNumber, approved: false, status: "published" }),
    Listing.countDocuments({ listerPhoneNumber, status: "published" }),
    Listing.countDocuments({ listerPhoneNumber, status: { $in: ["draft", "archived"] } }),
    listingIds.length ? Purchase.countDocuments({ listingId: { $in: listingIds } }) : 0,
    listingIds.length
      ? Purchase.find({ listingId: { $in: listingIds } }).sort({ createdAt: -1 }).limit(5).lean()
      : [],
  ]);

  const recentPurchases = recentPurchasesRaw.map((purchase) => ({
    listingTitle: listingTitleById[String(purchase?.listingId || "")] || "Listing",
    createdAt: purchase?.createdAt || null,
    amount: 0,
  }));

  return Response.json({
    totalListings: listings.length,
    pendingApproval,
    totalReports: 0,
    totalViews: totalPurchases,
    totalPurchases,
    activeListings,
    deactivatedListings,
    recentPurchases,
  });
}
