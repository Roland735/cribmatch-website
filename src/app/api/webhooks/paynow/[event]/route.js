import { NextResponse } from "next/server";
import { dbConnect, Listing, PaymentTransaction, Purchase, WebhookEvent } from "@/lib/db";
import Message from "@/lib/Message";

export const runtime = "nodejs";

function mapStatus(status) {
  const value = String(status || "").toLowerCase();
  if (value === "paid" || value === "delivered" || value === "awaiting delivery") return "paid";
  if (value.includes("cancel")) return "cancelled";
  if (value.includes("fail") || value.includes("error")) return "failed";
  return "pending_confirmation";
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function parseBody(rawBody) {
  const text = String(rawBody || "").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
  }
  const params = new URLSearchParams(text);
  const out = {};
  for (const [key, value] of params.entries()) {
    out[key] = value;
  }
  return out;
}

function pickValue(sources, keys) {
  for (const source of sources) {
    for (const key of keys) {
      const value = source?.[key];
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return String(value).trim();
      }
    }
  }
  return "";
}

async function sendWhatsAppPayload(payload) {
  const apiToken = process.env.WHATSAPP_API_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;
  if (!apiToken || !phoneNumberId) return { ok: false, error: "missing-whatsapp-credentials" };
  const response = await fetch(`https://graph.facebook.com/v24.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiToken}` },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  return { ok: response.ok && !result?.error, result };
}

async function sendWhatsAppText(phone, message) {
  const payload = {
    messaging_product: "whatsapp",
    to: digitsOnly(phone),
    type: "text",
    text: { body: String(message || "") },
  };
  return sendWhatsAppPayload(payload);
}

async function sendWhatsAppImage(phone, imageUrl, caption = "") {
  const payload = {
    messaging_product: "whatsapp",
    to: digitsOnly(phone),
    type: "image",
    image: { link: String(imageUrl || ""), ...(caption ? { caption: String(caption).slice(0, 1024) } : {}) },
  };
  return sendWhatsAppPayload(payload);
}

async function sendPaidListingDetails(transaction) {
  const phone = digitsOnly(transaction?.phone || "");
  const listingId = String(transaction?.listingId || "").trim();
  if (!phone || !listingId) return;

  const listing = await Listing.findById(listingId).lean().exec().catch(() => null);
  if (!listing) {
    await sendWhatsAppText(
      phone,
      "✅ Payment received successfully. We couldn't load the listing details right now. Please reply with Main menu and open the listing again.",
    ).catch(() => null);
    return;
  }

  const title = String(listing?.title || "Listing");
  const suburb = String(listing?.suburb || "");
  const address = String(listing?.address || "");
  const contactName = String(listing?.contactName || listing?.ownerName || "Owner");
  const contactPhone = String(listing?.contactPhone || listing?.listerPhoneNumber || listing?.contactWhatsApp || "N/A");
  const contactWhatsApp = String(listing?.contactWhatsApp || "");
  const contactEmail = String(listing?.contactEmail || listing?.email || "");
  const priceRaw = Number.isFinite(Number(listing?.pricePerMonth)) ? Number(listing.pricePerMonth) : Number(listing?.price);
  const price = Number.isFinite(priceRaw) ? `$${priceRaw}` : "N/A";

  const lines = [
    "✅ Payment successful. Here are the contact details:",
    "",
    `🏠 ${title}`,
    suburb ? `📍 Suburb: ${suburb}` : null,
    address ? `📍 Address: ${address}` : null,
    `💰 Price: ${price}`,
    "",
    `👤 Contact: ${contactName}`,
    `📞 Phone: ${contactPhone}`,
    contactWhatsApp ? `📱 WhatsApp: ${contactWhatsApp}` : null,
    contactEmail ? `📧 Email: ${contactEmail}` : null,
  ].filter(Boolean);

  await sendWhatsAppText(phone, lines.join("\n")).catch(() => null);

  const images = Array.isArray(listing?.images) ? listing.images.filter(Boolean).slice(0, 4) : [];
  for (let i = 0; i < images.length; i += 1) {
    await sendWhatsAppImage(phone, String(images[i]), i === 0 ? `📷 Photos: ${title}` : "").catch(() => null);
  }

  await Purchase.updateOne(
    { phone, listingId: String(listing?._id || listingId) },
    {
      $set: {
        listingSnapshot: {
          title: listing?.title,
          price: listing?.price || listing?.pricePerMonth,
          currency: listing?.currency || "USD",
          status: listing?.status,
        },
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  ).exec().catch(() => null);

  await Message.findOneAndUpdate(
    { phone },
    {
      $set: {
        "meta.state": "CONTACT_REVEALED",
        "meta.listingIdSelected": String(listing?._id || listingId),
      },
    },
    { sort: { createdAt: -1 }, upsert: false },
  ).exec().catch(() => null);
}

async function handlePaynowWebhook(request, params) {
  const url = new URL(request.url);
  const rawBody = await request.text().catch(() => "");
  const body = parseBody(rawBody);
  const query = Object.fromEntries(url.searchParams.entries());

  const reference = pickValue(
    [body, query],
    ["reference", "Reference", "merchantreference", "MerchantReference", "merchantReference", "ReferenceNo"],
  );
  const paynowReference = pickValue(
    [body, query],
    ["paynowreference", "PaynowReference", "paynowReference", "paynow_ref"],
  );
  const statusRaw = pickValue([body, query], ["status", "Status", "transactionstatus"]) || "pending";
  const normalizedStatus = mapStatus(statusRaw);

  try {
    await dbConnect();
    await WebhookEvent.create({
      provider: "paynow",
      receivedAt: new Date(),
      headers: Object.fromEntries(request.headers.entries()),
      payload: { params, body, rawBody, query },
    }).catch(() => null);

    const txFilter = reference
      ? { reference }
      : (paynowReference ? { paynowReference } : null);
    const existingTx = txFilter
      ? await PaymentTransaction.findOne(txFilter).lean().exec().catch(() => null)
      : null;

    if (existingTx?._id) {
      await PaymentTransaction.updateOne(
        { _id: existingTx._id },
        {
          $set: {
            status: normalizedStatus,
            ...(paynowReference ? { paynowReference } : {}),
            ...(normalizedStatus === "paid" && !existingTx.unlockedAt ? { unlockedAt: new Date() } : {}),
          },
          $push: {
            verificationLogs: {
              success: true,
              status: statusRaw,
              paid: normalizedStatus === "paid",
              message: `Webhook ${params?.event || "event"} received`,
              raw: { body, query, rawBody },
              createdAt: new Date(),
            },
          },
        },
      ).exec();

      if (normalizedStatus === "paid" && !existingTx.unlockedAt) {
        await sendPaidListingDetails(existingTx).catch(() => null);
      }
    } else if (reference || paynowReference) {
      await PaymentTransaction.updateOne(
        reference ? { reference } : { paynowReference },
        {
          $set: {
            status: normalizedStatus,
            ...(paynowReference ? { paynowReference } : {}),
          },
          $push: {
            verificationLogs: {
              success: true,
              status: statusRaw,
              paid: normalizedStatus === "paid",
              message: `Webhook ${params?.event || "event"} received`,
              raw: { body, query, rawBody },
              createdAt: new Date(),
            },
          },
        },
      ).exec();
    }
  } catch {
  }

  return NextResponse.json({ ok: true });
}

export async function GET(request, { params }) {
  return handlePaynowWebhook(request, params);
}

export async function POST(request, { params }) {
  return handlePaynowWebhook(request, params);
}
