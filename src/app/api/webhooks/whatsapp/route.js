import { NextResponse } from "next/server";
import { dbConnect, WebhookEvent, Listing } from "@/lib/db";
import Message from "@/lib/Message";
import seedListings from "@/lib/seedListings.json";
import { searchListings } from "@/lib/getListings";

export const runtime = "nodejs";

// Graph API send endpoint (we post to /{PHONE_NUMBER_ID}/messages)
// The code below will use the env var WHATSAPP_API_TOKEN and WHATSAPP_PHONE_NUMBER_ID

function digitsOnly(v) {
  return String(v || "").replace(/\D/g, "");
}

async function whatsappPost(phone_number_id, token, bodyObj) {
  const url = `https://graph.facebook.com/v24.0/${phone_number_id}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(bodyObj),
  });
  try {
    return await res.json();
  } catch (e) {
    return { error: "invalid-json", status: res.status };
  }
}

async function sendText(phoneNumber, message) {
  const apiToken = process.env.WHATSAPP_API_TOKEN || process.env.WHATCHIMP_API_KEY;
  const phone_number_id =
    process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATCHIMP_PHONE_ID || process.env.WHATCHIMP_PHONE_NUMBER_ID;
  if (!apiToken || !phone_number_id) return { error: "missing-credentials" };

  const payload = {
    messaging_product: "whatsapp",
    to: digitsOnly(phoneNumber),
    type: "text",
    text: { body: message },
  };

  return whatsappPost(phone_number_id, apiToken, payload);
}

// simple retry helper
async function retry(fn, attempts = 3, delay = 400) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

async function getListingById(listingId) {
  const id = String(listingId || "").trim();
  if (!id) return null;

  if (!process.env.MONGODB_URI) {
    return seedListings.find((l) => String(l?._id) === id) || null;
  }

  await dbConnect();
  const doc = await Listing.findById(id).lean().exec().catch(() => null);
  return doc || null;
}

async function searchPublishedListings({ q = "", minPrice = null, maxPrice = null, perPage = 6 } = {}) {
  return searchListings({
    status: "published",
    q,
    minPrice,
    maxPrice,
    page: 1,
    perPage,
  });
}

// ================= Conversation / Menu helpers =================
async function sendMenu(phone) {
  const text = [
    "Welcome to CribMatch 👋 — choose an option:",
    "1) List a property",
    "2) Search properties",
    "3) View my purchases",
    "",
    "Reply with the number (e.g. 1) or the word (e.g. 'list').",
  ].join("\n");

  const sys = await Message.create({
    phone: digitsOnly(phone),
    from: "system",
    type: "text",
    text,
    raw: null,
    meta: { state: "AWAITING_MENU_CHOICE" },
  }).catch(() => null);

  await sendText(phone, text);
  return sys;
}

async function getLastConversationState(phone) {
  const doc = await Message.findOne({ phone: digitsOnly(phone), "meta.state": { $exists: true } })
    .sort({ createdAt: -1 })
    .lean()
    .exec();
  return doc?.meta || null;
}

function interpretMenuChoice(text) {
  if (!text) return null;
  const t = String(text || "").trim().toLowerCase();
  if (/^\s*1\s*$/.test(t) || t.startsWith("list") || t.includes("list a")) return "LIST";
  if (/^\s*2\s*$/.test(t) || t.startsWith("search") || t.includes("search")) return "SEARCH";
  if (/^\s*3\s*$/.test(t) || t.startsWith("purchase") || t.includes("purchase") || t.includes("orders")) return "PURCHASES";
  return null;
}

// Minimal payment link creator placeholder (replace with Stripe/Payfast)
async function createPaymentLink(phone, amountCents, description = "Contact details") {
  const fakeId = Date.now().toString(36);
  return {
    id: `pay_${fakeId}`,
    url: `https://payments.example.com/pay/${fakeId}?amount=${amountCents}&phone=${encodeURIComponent(phone)}`,
    amount: amountCents,
  };
}

async function revealContactDetails(listingId, phone) {
  const listing = await getListingById(listingId);
  if (!listing) {
    await sendText(phone, "Sorry — listing not found.");
    return;
  }

  const contactMessage = [
    `Contact info for "${listing.title}":`,
    `Name: ${listing.contactName || "N/A"}`,
    `Phone: ${listing.contactPhone || "N/A"}`,
    `WhatsApp: ${listing.contactWhatsApp || "N/A"}`,
    `Email: ${listing.contactEmail || "N/A"}`,
    "",
    "Note: address and exact location are not shared until meeting is arranged.",
  ].join("\n");

  await Message.create({
    phone: digitsOnly(phone),
    from: "system",
    type: "text",
    text: contactMessage,
    meta: { state: "CONTACT_REVEALED", listingId },
  }).catch(() => { });

  await sendText(phone, contactMessage);
}

// ================= Timestamp extraction helper =================
function extractTimestamp(payload, messageBlock) {
  const candidates = [];
  if (payload?.timestamp) candidates.push(payload.timestamp);
  if (messageBlock?.timestamp) candidates.push(messageBlock.timestamp);
  if (messageBlock?.conversation_time) candidates.push(messageBlock.conversation_time);
  try {
    const msg =
      payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] || payload?.messages?.[0] || messageBlock?.messages?.[0];
    if (msg?.timestamp) candidates.push(msg.timestamp);
  } catch (e) { }

  for (const c of candidates) {
    if (!c) continue;
    if (/^\d+$/.test(String(c))) {
      const n = Number(String(c));
      if (String(c).length <= 10) return n * 1000;
      return n;
    }
    const d = new Date(String(c));
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  return null;
}

// ================= Webhook handlers =================
export async function GET(request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expectedToken =
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ||
    process.env.WHATSAPP_VERIFY_TOKEN ||
    process.env.WHATSAPP_VERIFY ||
    process.env.WHATSAPP_WEBHOOK_VERIFY ||
    process.env.WHATSAPP_TOKEN ||
    process.env.META_WEBHOOK_VERIFY_TOKEN ||
    process.env.WEBHOOK_VERIFY_TOKEN ||
    "";

  if (!expectedToken) {
    return new Response("Missing verify token", { status: 500, headers: { "Cache-Control": "no-store" } });
  }

  if (mode === "subscribe" && token && challenge && token === expectedToken) {
    return new Response(challenge, { status: 200, headers: { "Cache-Control": "no-store" } });
  }

  return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  console.log("[webhook] POST invoked");
  try {
    await dbConnect();
  } catch (err) {
    console.error("[webhook] DB connect failed", err);
    return NextResponse.json({ ok: false, error: "DB connect failed" }, { status: 500 });
  }

  let payload = {};
  try {
    payload = await request.json();
  } catch (err) {
    try {
      const t = await request.text();
      payload = t ? JSON.parse(t) : {};
    } catch (e) {
      payload = {};
    }
  }
  console.log("[webhook] payload keys:", Object.keys(payload));

  try {
    const headersObj = Object.fromEntries(request.headers.entries());
    await WebhookEvent.create({ provider: "whatsapp", headers: headersObj, payload, receivedAt: new Date() });
  } catch (e) {
    console.warn("[webhook] save raw event failed:", e);
  }

  let messageBlock = payload;
  if (payload.user_message) messageBlock = { text: payload.user_message };
  else if (payload.message_content && typeof payload.message_content === "string") {
    try {
      messageBlock = JSON.parse(payload.message_content);
    } catch (e) {
      messageBlock = payload.message_content;
    }
  } else if (payload.message) messageBlock = payload.message;
  else if (payload.data) messageBlock = payload.data;

  const rawCandidates = [
    payload.chat_id,
    payload.subscriber_id ? String(payload.subscriber_id).split("-")[0] : null,
    payload.phone_number,
    payload.from,
    messageBlock?.to,
    messageBlock?.from,
    messageBlock?.recipient,
    payload?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.wa_id,
    payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from,
  ].filter(Boolean);

  const phone = digitsOnly(rawCandidates[0] || "");

  const parsedText =
    payload.user_message || (messageBlock && (messageBlock.text || messageBlock.body?.text || messageBlock.body?.plain)) || "";

  const incoming = {
    phone,
    from: payload.sender || payload.from || messageBlock?.from || "user",
    wa_message_id:
      payload.wa_message_id || messageBlock?.wa_message_id || payload.message_id || (payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id) || null,
    type: parsedText ? "text" : "unknown",
    text: parsedText,
    raw: payload,
    status: null,
    meta: {},
    conversationId: payload.conversation_id || null,
  };

  const savedMsg = await Message.create(incoming).catch((e) => {
    console.error("[webhook] save message error", e);
    return null;
  });

  // Conversation routing
  try {
    const lastMeta = await getLastConversationState(phone);

    if (!lastMeta) {
      await sendMenu(phone);
      await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.triggeredMenu": true } }).catch(() => { });
      return NextResponse.json({ ok: true, note: "menu-sent" });
    }

    if (lastMeta.state === "AWAITING_MENU_CHOICE") {
      const choice = interpretMenuChoice(parsedText);
      if (!choice) {
        await sendText(phone, "Sorry, I didn't understand. Reply with 1 (List), 2 (Search) or 3 (Purchases).");
        return NextResponse.json({ ok: true, note: "menu-repeat" });
      }

      if (choice === "LIST") {
        await Message.create({
          phone: digitsOnly(phone),
          from: "system",
          type: "text",
          text: "Okay — let's list a property. What's the property title?",
          meta: { state: "LISTING_WAIT_TITLE", draft: {} },
        }).catch(() => { });
        await sendText(phone, "Okay — let's list a property. What's the property title?");
        await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.handledMenu": true } }).catch(() => { });
        return NextResponse.json({ ok: true, note: "start-listing" });
      }

      if (choice === "SEARCH") {
        await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: "Tell me area and budget (eg: Borrowdale, $200).", meta: { state: "SEARCH_WAIT_AREA_BUDGET" } }).catch(() => { });
        await sendText(phone, "Tell me area and budget (eg: Borrowdale, $200).");
        return NextResponse.json({ ok: true, note: "start-search" });
      }

      if (choice === "PURCHASES") {
        const purchasesPlaceholder = "You have 0 purchases. (This is a placeholder — wire your purchases DB.)";
        await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: purchasesPlaceholder, meta: { state: "SHOW_PURCHASES" } }).catch(() => { });
        await sendText(phone, purchasesPlaceholder);
        return NextResponse.json({ ok: true, note: "show-purchases" });
      }
    }

    // Listing flow states
    if (lastMeta.state && lastMeta.state.startsWith("LISTING_WAIT_")) {
      const draftContainer = await Message.findOne({ phone: digitsOnly(phone), "meta.draft": { $exists: true } }).sort({ createdAt: -1 }).exec();
      let draft = draftContainer?.meta?.draft || {};

      if (lastMeta.state === "LISTING_WAIT_TITLE") {
        draft.title = parsedText;
        await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: "Got it. What suburb is it in?", meta: { state: "LISTING_WAIT_SUBURB", draft } }).catch(() => { });
        await sendText(phone, "Got it. What suburb is it in?");
        return NextResponse.json({ ok: true, note: "listing-title-saved" });
      }

      if (lastMeta.state === "LISTING_WAIT_SUBURB") {
        draft.suburb = parsedText;
        await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: "Property type (e.g. House, Apartment)?", meta: { state: "LISTING_WAIT_TYPE", draft } }).catch(() => { });
        await sendText(phone, "Property type (e.g. House, Apartment)?");
        return NextResponse.json({ ok: true, note: "listing-suburb-saved" });
      }

      if (lastMeta.state === "LISTING_WAIT_TYPE") {
        draft.propertyType = parsedText;
        await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: "Monthly price (numbers only)?", meta: { state: "LISTING_WAIT_PRICE", draft } }).catch(() => { });
        await sendText(phone, "Monthly price (numbers only)?");
        return NextResponse.json({ ok: true, note: "listing-type-saved" });
      }

      if (lastMeta.state === "LISTING_WAIT_PRICE") {
        const price = Number(parsedText.replace(/[^\d.]/g, "")) || 0;
        draft.pricePerMonth = price;
        await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: "How many bedrooms?", meta: { state: "LISTING_WAIT_BEDS", draft } }).catch(() => { });
        await sendText(phone, "How many bedrooms?");
        return NextResponse.json({ ok: true, note: "listing-price-saved" });
      }

      if (lastMeta.state === "LISTING_WAIT_BEDS") {
        const beds = Math.max(0, parseInt(parsedText, 10) || 0);
        draft.bedrooms = beds;
        await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: "Add a short description or send 'skip'.", meta: { state: "LISTING_WAIT_DESC", draft } }).catch(() => { });
        await sendText(phone, "Add a short description or send 'skip'.");
        return NextResponse.json({ ok: true, note: "listing-beds-saved" });
      }

      if (lastMeta.state === "LISTING_WAIT_DESC") {
        draft.description = parsedText && parsedText.toLowerCase() !== "skip" ? parsedText : "";
        const newListing = await Listing.create({
          title: draft.title || "Untitled",
          listerPhoneNumber: phone,
          suburb: draft.suburb || "",
          propertyType: draft.propertyType || "Unknown",
          pricePerMonth: draft.pricePerMonth || 0,
          bedrooms: draft.bedrooms || 0,
          description: draft.description || "",
          images: [],
          contactName: "",
          contactPhone: "",
          contactWhatsApp: "",
          contactEmail: "",
        }).catch((e) => {
          console.error("listing create failed", e);
          return null;
        });

        if (newListing) {
          const confirm = `Listing created: "${newListing.title}" — ID: ${newListing._id}\nTo add contact details or images, reply with \"edit ${newListing._id}\"`;
          await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: confirm, meta: { state: "LISTING_CREATED", listingId: newListing._id } }).catch(() => { });
          await sendText(phone, confirm);
        } else {
          await sendText(phone, "Failed to create listing — please try again later.");
        }
        return NextResponse.json({ ok: true, note: "listing-created" });
      }
    }

    // Search flow
    if (lastMeta.state === "SEARCH_WAIT_AREA_BUDGET") {
      const parts = parsedText.split(/[ ,\n]/).map((s) => s.trim()).filter(Boolean);
      const area = parts[0] || "";
      const budgetMatch = parsedText.match(/\$?(\d+(?:\.\d+)?)/);
      const budget = budgetMatch ? Number(budgetMatch[1]) : null;

      const results = await searchPublishedListings({ q: area, minPrice: null, maxPrice: budget, perPage: 6 });
      const msg = results.listings.length
        ? results.listings.map((l) => `${l.title} — ${l.suburb} — $${l.pricePerMonth} — ID:${l._id}`).join("\n\n")
        : "No matches found. Try a broader area or higher budget.";

      await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: msg, meta: { state: "SEARCH_RESULTS", query: { area, budget }, resultsCount: results.total } }).catch(() => { });
      await sendText(phone, msg);
      await sendText(phone, "To view contact details for any listing reply with: CONTACT <LISTING_ID>");
      return NextResponse.json({ ok: true, note: "search-results-sent" });
    }

    // CONTACT flow
    if (/^contact\s+/i.test(parsedText || "")) {
      const listingId = (parsedText || "").split(/\s+/)[1];
      if (!listingId) {
        await sendText(phone, "Please reply with: CONTACT <listing-id>");
        return NextResponse.json({ ok: true, note: "contact-missing-id" });
      }

      const payment = await createPaymentLink(phone, 300, `Contact for listing ${listingId}`);
      await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: `Contact costs $3. Pay here: ${payment.url}`, meta: { state: "CONTACT_PAYMENT_PENDING", listingId, payment } }).catch(() => { });
      await sendText(phone, `Contact costs $3. Pay here: ${payment.url}\nAfter paying, reply with: PAID ${payment.id}`);
      return NextResponse.json({ ok: true, note: "contact-payment-requested" });
    }

    // PAID fallback (rudimentary)
    if (/^paid\s+/i.test(parsedText || "")) {
      const paymentId = (parsedText || "").split(/\s+/)[1];
      if (!paymentId) {
        await sendText(phone, "Please reply with: PAID <payment-id>");
        return NextResponse.json({ ok: true, note: "paid-missing-id" });
      }

      const pend2 = await Message.findOne({ phone: digitsOnly(phone), "meta.state": "CONTACT_PAYMENT_PENDING" }).sort({ createdAt: -1 }).lean().exec();
      if (pend2) {
        await revealContactDetails(pend2.meta.listingId, phone);
        return NextResponse.json({ ok: true, note: "contact-revealed" });
      }

      await sendText(phone, "Could not find a pending payment / listing. Please try again.");
      return NextResponse.json({ ok: false, note: "payment-not-found" });
    }

  } catch (e) {
    console.warn("[webhook] conversation routing error:", e);
    // continue to existing free-text/send logic below
  }

  // Determine whether we are allowed to send free-text based on last user message timestamp
  const windowMs = Number(process.env.WHATSAPP_FREE_WINDOW_MS) || 24 * 60 * 60 * 1000;
  let allowedToSend = false;

  const ts = extractTimestamp(payload, messageBlock);
  if (ts) {
    const age = Date.now() - ts;
    console.log(`[webhook] incoming message ageMs=${age}`);
    if (age <= windowMs) allowedToSend = true;
  } else {
    if (savedMsg) allowedToSend = true;
  }

  console.log("[webhook] allowedToSend =", allowedToSend);

  if (!allowedToSend) {
    await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.needsFollowUp": true } }).catch(() => { });
    return NextResponse.json({ ok: true, note: "not-allowed-to-send-free-text-yet" });
  }

  // If allowed, attempt the free-text send using Graph API
  const replyText = `Hi 👋 Welcome to CribMatch — tell me area and budget (eg. Borrowdale, $200) and I'll find matches.`;
  const sendResp = await sendText(phone, replyText);
  console.log("[webhook] sendText response:", sendResp);

  if (sendResp?.error) {
    await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.sendError": sendResp } }).catch(() => { });
    const msg = String(sendResp?.error?.message || sendResp?.error || "");
    if (/24 hour|message template/i.test(msg)) {
      await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.templateRequired": true, "meta.sendResp": sendResp } }).catch(() => { });
      return NextResponse.json({ ok: true, note: "send-rejected-24-hour", sendResp });
    }
    return NextResponse.json({ ok: false, error: sendResp }, { status: 500 });
  }

  await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.sendResp": sendResp } }).catch(() => { });
  return NextResponse.json({ ok: true, savedMessageId: savedMsg?._id || null, sendResp });
}
