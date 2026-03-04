import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbConnect, Purchase, Listing } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const phoneNumber = typeof session?.user?.phoneNumber === "string" ? session.user.phoneNumber.trim() : "";
  if (!phoneNumber) {
    return Response.json({ error: "Missing phone number" }, { status: 400 });
  }

  try {
    await dbConnect();
    
    // Find purchases and populate listing data
    const purchases = await Purchase.find({ phone: phoneNumber })
      .sort({ createdAt: -1 })
      .lean();

    // Manually populate listing data since ref might not work as expected with custom ID strings
    const enrichedPurchases = await Promise.all(purchases.map(async (purchase) => {
      let listing = null;
      try {
        listing = await Listing.findById(purchase.listingId).lean();
      } catch (e) {
        console.error("Error fetching listing for purchase:", e);
      }
      
      return {
        ...purchase,
        _id: purchase._id.toString(),
        listing: listing ? {
          _id: listing._id.toString(),
          title: listing.title,
          suburb: listing.suburb,
          pricePerMonth: listing.pricePerMonth,
          images: listing.images,
          shortId: listing.shortId
        } : (purchase.listingSnapshot || null)
      };
    }));

    return Response.json({ purchases: enrichedPurchases });
  } catch (error) {
    console.error("API Purchases Error:", error);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
