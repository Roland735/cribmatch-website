import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbConnect, Report, Listing } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session?.user?.role !== "admin") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  await dbConnect();
  const reports = await Report.find().sort({ createdAt: -1 }).lean();

  const enrichedReports = await Promise.all(
    reports.map(async (report) => {
      const listing = await Listing.findById(report.listingId).select("title shortId suburb pricePerMonth").lean();
      return { ...report, listing };
    })
  );

  return Response.json({ reports: enrichedReports });
}

export async function PATCH(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session?.user?.role !== "admin") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { reportId, status } = body;

  if (!reportId || !status) {
    return Response.json({ error: "Missing fields" }, { status: 400 });
  }

  await dbConnect();
  const report = await Report.findByIdAndUpdate(reportId, { status }, { new: true });

  if (!report) {
    return Response.json({ error: "Report not found" }, { status: 404 });
  }

  return Response.json({ report });
}
