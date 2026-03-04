import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbConnect, Listing, Purchase, Report, User } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session?.user?.role !== "admin") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  await dbConnect();

  try {
    const [
      totalListings,
      pendingApproval,
      totalPurchases,
      totalReports,
      pendingReports,
      totalUsers,
      recentPurchases,
      recentReports,
    ] = await Promise.all([
      Listing.countDocuments(),
      Listing.countDocuments({ approved: false, status: "published" }),
      Purchase.countDocuments(),
      Report.countDocuments(),
      Report.countDocuments({ status: "pending" }),
      User.countDocuments(),
      Purchase.find().sort({ createdAt: -1 }).limit(5).lean(),
      Report.find().sort({ createdAt: -1 }).limit(5).lean(),
    ]);

    // Enriched recent data
    const enrichedPurchases = await Promise.all(
      recentPurchases.map(async (p) => {
        const listing = await Listing.findById(p.listingId).select("title shortId").lean();
        return { ...p, listing };
      })
    );

    const enrichedReports = await Promise.all(
      recentReports.map(async (r) => {
        const listing = await Listing.findById(r.listingId).select("title shortId").lean();
        return { ...r, listing };
      })
    );

    return Response.json({
      stats: {
        listings: { total: totalListings, pending: pendingApproval },
        purchases: { total: totalPurchases },
        reports: { total: totalReports, pending: pendingReports },
        users: { total: totalUsers },
      },
      recent: {
        purchases: enrichedPurchases,
        reports: enrichedReports,
      },
    });
  } catch (error) {
    console.error("Admin stats error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
