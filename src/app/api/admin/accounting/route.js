import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbConnect, Listing, PaymentTransaction } from "@/lib/db";

export const runtime = "nodejs";

function parseDateInput(value, { endOfDay = false } = {}) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(`${raw}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function toIsoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function toSafeNumber(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function normalizeListingTitle(value, fallback = "Listing") {
  const title = typeof value === "string" ? value.trim() : "";
  return title || fallback;
}

export async function GET(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session?.user?.role !== "admin") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requestUrl = new URL(request.url);
  const fromInput = requestUrl.searchParams.get("from") || "";
  const toInput = requestUrl.searchParams.get("to") || "";
  const listingId = String(requestUrl.searchParams.get("listingId") || "").trim();
  const limitInput = Number(requestUrl.searchParams.get("limit") || 100);
  const limit = Number.isFinite(limitInput) ? Math.min(Math.max(Math.round(limitInput), 1), 300) : 100;

  const fromDate = parseDateInput(fromInput);
  const toDate = parseDateInput(toInput, { endOfDay: true });

  if (fromInput && !fromDate) {
    return Response.json({ error: "Invalid from date. Use YYYY-MM-DD." }, { status: 400 });
  }
  if (toInput && !toDate) {
    return Response.json({ error: "Invalid to date. Use YYYY-MM-DD." }, { status: 400 });
  }
  if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
    return Response.json({ error: "From date cannot be after to date." }, { status: 400 });
  }

  const baseMatch = { status: "paid" };
  if (fromDate || toDate) {
    baseMatch.createdAt = {};
    if (fromDate) baseMatch.createdAt.$gte = fromDate;
    if (toDate) baseMatch.createdAt.$lte = toDate;
  }
  const selectedMatch = listingId ? { ...baseMatch, listingId } : baseMatch;

  await dbConnect();

  try {
    const [summaryRows, topListingsRows, listingFilterRows, selectedListingDoc, selectedSummaryRows, recentSalesRows] =
      await Promise.all([
        PaymentTransaction.aggregate([
          { $match: baseMatch },
          {
            $group: {
              _id: null,
              totalSales: { $sum: 1 },
              totalRevenueUsd: { $sum: { $ifNull: ["$amount", 0] } },
              firstSaleAt: { $min: "$createdAt" },
              lastSaleAt: { $max: "$createdAt" },
            },
          },
        ]),
        PaymentTransaction.aggregate([
          { $match: baseMatch },
          {
            $group: {
              _id: "$listingId",
              salesCount: { $sum: 1 },
              totalRevenueUsd: { $sum: { $ifNull: ["$amount", 0] } },
              firstSaleAt: { $min: "$createdAt" },
              lastSaleAt: { $max: "$createdAt" },
              listingTitle: { $first: "$listingTitle" },
              listingCode: { $first: "$listingCode" },
            },
          },
          { $sort: { salesCount: -1, totalRevenueUsd: -1, lastSaleAt: -1 } },
          { $limit: 10 },
          {
            $lookup: {
              from: "listings",
              localField: "_id",
              foreignField: "_id",
              as: "listing",
            },
          },
          { $unwind: { path: "$listing", preserveNullAndEmptyArrays: true } },
          {
            $project: {
              _id: 0,
              listingId: "$_id",
              salesCount: 1,
              totalRevenueUsd: 1,
              firstSaleAt: 1,
              lastSaleAt: 1,
              listingTitle: { $ifNull: ["$listing.title", "$listingTitle"] },
              listingCode: { $ifNull: ["$listing.shortId", "$listingCode"] },
              city: "$listing.city",
              suburb: "$listing.suburb",
              propertyType: "$listing.propertyType",
              pricePerMonth: "$listing.pricePerMonth",
              status: "$listing.status",
              approved: "$listing.approved",
              listerPhoneNumber: "$listing.listerPhoneNumber",
            },
          },
        ]),
        PaymentTransaction.aggregate([
          { $match: baseMatch },
          {
            $group: {
              _id: "$listingId",
              salesCount: { $sum: 1 },
              totalRevenueUsd: { $sum: { $ifNull: ["$amount", 0] } },
              lastSaleAt: { $max: "$createdAt" },
              listingTitle: { $first: "$listingTitle" },
            },
          },
          { $sort: { salesCount: -1, totalRevenueUsd: -1, lastSaleAt: -1 } },
          {
            $project: {
              _id: 0,
              listingId: "$_id",
              salesCount: 1,
              totalRevenueUsd: 1,
              lastSaleAt: 1,
              listingTitle: 1,
            },
          },
        ]),
        listingId ? Listing.findById(listingId).lean().exec() : Promise.resolve(null),
        listingId
          ? PaymentTransaction.aggregate([
            { $match: { ...baseMatch, listingId } },
            {
              $group: {
                _id: null,
                salesCount: { $sum: 1 },
                totalRevenueUsd: { $sum: { $ifNull: ["$amount", 0] } },
                firstSaleAt: { $min: "$createdAt" },
                lastSaleAt: { $max: "$createdAt" },
              },
            },
          ])
          : Promise.resolve([]),
        PaymentTransaction.find(selectedMatch)
          .sort({ createdAt: -1 })
          .limit(limit)
          .select(
            "_id listingId listingTitle listingCode phone payerMobile amount currency reference status createdAt updatedAt unlockedAt",
          )
          .lean()
          .exec(),
      ]);

    const listingTitleById = new Map();
    for (const row of listingFilterRows) {
      listingTitleById.set(
        String(row?.listingId || ""),
        normalizeListingTitle(row?.listingTitle),
      );
    }
    for (const row of topListingsRows) {
      listingTitleById.set(
        String(row?.listingId || ""),
        normalizeListingTitle(row?.listingTitle),
      );
    }
    if (selectedListingDoc?._id) {
      listingTitleById.set(
        String(selectedListingDoc._id),
        normalizeListingTitle(selectedListingDoc?.title),
      );
    }

    const summary = summaryRows[0] || {};
    const selectedSummary = selectedSummaryRows[0] || null;

    return Response.json({
      range: {
        from: toIsoOrNull(fromDate),
        to: toIsoOrNull(toDate),
      },
      summary: {
        totalSales: Number(summary?.totalSales || 0),
        totalRevenueUsd: toSafeNumber(summary?.totalRevenueUsd),
        firstSaleAt: toIsoOrNull(summary?.firstSaleAt),
        lastSaleAt: toIsoOrNull(summary?.lastSaleAt),
      },
      topListings: topListingsRows.map((row) => ({
        listingId: String(row?.listingId || ""),
        listingTitle: normalizeListingTitle(row?.listingTitle),
        listingCode: typeof row?.listingCode === "string" ? row.listingCode : "",
        salesCount: Number(row?.salesCount || 0),
        totalRevenueUsd: toSafeNumber(row?.totalRevenueUsd),
        firstSaleAt: toIsoOrNull(row?.firstSaleAt),
        lastSaleAt: toIsoOrNull(row?.lastSaleAt),
        city: typeof row?.city === "string" ? row.city : "",
        suburb: typeof row?.suburb === "string" ? row.suburb : "",
        propertyType: typeof row?.propertyType === "string" ? row.propertyType : "",
        pricePerMonth: toSafeNumber(row?.pricePerMonth),
        status: typeof row?.status === "string" ? row.status : "",
        approved: Boolean(row?.approved),
        listerPhoneNumber: typeof row?.listerPhoneNumber === "string" ? row.listerPhoneNumber : "",
      })),
      listingFilters: listingFilterRows.map((row) => ({
        listingId: String(row?.listingId || ""),
        listingTitle: normalizeListingTitle(row?.listingTitle),
        salesCount: Number(row?.salesCount || 0),
        totalRevenueUsd: toSafeNumber(row?.totalRevenueUsd),
        lastSaleAt: toIsoOrNull(row?.lastSaleAt),
      })),
      selectedListing: listingId
        ? {
          listingId,
          title: normalizeListingTitle(
            selectedListingDoc?.title,
            listingTitleById.get(listingId) || "Listing",
          ),
          shortId: typeof selectedListingDoc?.shortId === "string" ? selectedListingDoc.shortId : "",
          city: typeof selectedListingDoc?.city === "string" ? selectedListingDoc.city : "",
          suburb: typeof selectedListingDoc?.suburb === "string" ? selectedListingDoc.suburb : "",
          propertyType: typeof selectedListingDoc?.propertyType === "string" ? selectedListingDoc.propertyType : "",
          pricePerMonth: toSafeNumber(selectedListingDoc?.pricePerMonth),
          status: typeof selectedListingDoc?.status === "string" ? selectedListingDoc.status : "",
          approved: Boolean(selectedListingDoc?.approved),
          listerPhoneNumber:
            typeof selectedListingDoc?.listerPhoneNumber === "string"
              ? selectedListingDoc.listerPhoneNumber
              : "",
          salesCount: Number(selectedSummary?.salesCount || 0),
          totalRevenueUsd: toSafeNumber(selectedSummary?.totalRevenueUsd),
          firstSaleAt: toIsoOrNull(selectedSummary?.firstSaleAt),
          lastSaleAt: toIsoOrNull(selectedSummary?.lastSaleAt),
        }
        : null,
      sales: recentSalesRows.map((row) => {
        const normalizedListingId = String(row?.listingId || "");
        return {
          id: String(row?._id || ""),
          listingId: normalizedListingId,
          listingTitle: normalizeListingTitle(
            row?.listingTitle,
            listingTitleById.get(normalizedListingId) || "Listing",
          ),
          listingCode: typeof row?.listingCode === "string" ? row.listingCode : "",
          amount: toSafeNumber(row?.amount),
          currency: typeof row?.currency === "string" ? row.currency : "USD",
          reference: typeof row?.reference === "string" ? row.reference : "",
          status: typeof row?.status === "string" ? row.status : "",
          phone: typeof row?.phone === "string" ? row.phone : "",
          payerMobile: typeof row?.payerMobile === "string" ? row.payerMobile : "",
          saleDate: toIsoOrNull(row?.unlockedAt || row?.updatedAt || row?.createdAt),
          createdAt: toIsoOrNull(row?.createdAt),
        };
      }),
    });
  } catch (error) {
    console.error("Admin accounting error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
