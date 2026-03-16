import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbConnect, Listing, PaymentTransaction, Purchase } from "@/lib/db";
import { getListingById } from "@/lib/getListings";
import { initiatePaynowEcocashPayment, verifyPaynowPayment } from "@/lib/paynowPayment";

export const runtime = "nodejs";

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function buildSnapshot(listing) {
  return {
    title: listing?.title || "Listing",
    price: listing?.pricePerMonth ?? listing?.price ?? null,
    currency: "USD",
    status: listing?.status || "published",
  };
}

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessionPhoneRaw =
    typeof session?.user?.phoneNumber === "string" ? session.user.phoneNumber.trim() : "";
  const sessionPhone = digitsOnly(sessionPhoneRaw);
  if (!sessionPhone) {
    return Response.json({ error: "Missing phone number on user profile" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const action = String(body?.action || "").trim().toLowerCase();
  const listingId = String(body?.listingId || "").trim();

  if (!listingId) {
    return Response.json({ error: "Listing ID is required" }, { status: 400 });
  }

  await dbConnect();

  if (action === "start") {
    const existing = await Purchase.findOne({ phone: sessionPhone, listingId }).lean().exec();
    if (existing) {
      return Response.json({ ok: true, alreadyPurchased: true, paid: true, status: "paid" });
    }

    const listing = await getListingById(listingId, { approvedOnly: true });
    if (!listing) {
      return Response.json({ error: "Listing not found" }, { status: 404 });
    }

    const payerMobile = String(body?.payerMobile || "").trim();
    const started = await initiatePaynowEcocashPayment({
      phone: sessionPhone,
      payerMobile,
      listing,
      maxPushRetries: 2,
    });

    if (!started?.ok) {
      return Response.json(
        { error: started?.userMessage || "Failed to start EcoCash payment" },
        { status: 400 },
      );
    }

    return Response.json({
      ok: true,
      transactionId: started.transactionId,
      reference: started.reference,
      instructions: started.instructions || "",
      status: "pending_confirmation",
      paid: false,
    });
  }

  if (action === "verify") {
    const transactionId = String(body?.transactionId || "").trim();
    if (!transactionId) {
      return Response.json({ error: "Transaction ID is required" }, { status: 400 });
    }

    const tx = await PaymentTransaction.findById(transactionId).lean().exec();
    if (!tx) {
      return Response.json({ error: "Payment transaction not found" }, { status: 404 });
    }
    if (String(tx.phone || "") !== sessionPhone) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    if (String(tx.listingId || "") !== listingId) {
      return Response.json({ error: "Payment does not match this listing" }, { status: 400 });
    }

    const verification = await verifyPaynowPayment(transactionId);
    if (!verification?.ok) {
      return Response.json(
        {
          ok: false,
          paid: false,
          status: "verification_error",
          error: verification?.userMessage || "Could not verify payment",
        },
        { status: 400 },
      );
    }

    if (!verification.paid) {
      return Response.json({
        ok: true,
        paid: false,
        status: String(verification.status || "pending_confirmation"),
      });
    }

    const listing =
      (await getListingById(listingId, { approvedOnly: false })) ||
      (await Listing.findById(listingId).lean().exec());

    await Purchase.updateOne(
      { phone: sessionPhone, listingId },
      {
        $set: { listingSnapshot: buildSnapshot(listing) },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    ).exec();

    return Response.json({ ok: true, paid: true, status: "paid" });
  }

  return Response.json({ error: "Invalid action" }, { status: 400 });
}
