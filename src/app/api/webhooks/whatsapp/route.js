// app/api/webhooks/whatsapp/route.js
import { NextResponse } from "next/server";
import crypto from "crypto";
import { dbConnect, WebhookEvent, Listing } from "@/lib/db";
import Message from "@/lib/Message";
import { getListingById, searchPublishedListings } from "@/lib/getListings";

export const runtime = "nodejs";

/* -------------------------
   Helpers
   ------------------------- */
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
  const apiToken = process.env.WHATSAPP_API_TOKEN;
  const phone_number_id = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;
  if (!apiToken || !phone_number_id) return { error: "missing-credentials" };

  const payload = {
    messaging_product: "whatsapp",
    to: digitsOnly(phoneNumber),
    type: "text",
    text: { body: message },
  };

  return whatsappPost(phone_number_id, apiToken, payload);
}

async function sendInteractiveButtons(phoneNumber, bodyText, buttons = []) {
  const apiToken = process.env.WHATSAPP_API_TOKEN;
  const phone_number_id = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;
  if (!apiToken || !phone_number_id) return { error: "missing-credentials" };

  const interactivePayload = {
    messaging_product: "whatsapp",
    to: digitsOnly(phoneNumber),
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })),
      },
    },
  };

  const res = await whatsappPost(phone_number_id, apiToken, interactivePayload);
  if (res?.error) {
    const fallback = [
      bodyText,
      "",
      ...buttons.map((b, i) => `${i + 1}) ${b.title}`),
      "",
      "Reply with the number (e.g. 1) or the word (e.g. 'list').",
    ].join("\n");
    await sendText(phoneNumber, fallback);
  }
  return res;
}

/* -------------------------
   Flow helper & config (Search Flow only)
   ------------------------- */
const DEFAULT_FLOW_ID = process.env.WHATSAPP_FLOW_ID || "1534021024566343";
const ENABLE_SEARCH_FLOW = (String(process.env.ENABLE_SEARCH_FLOW || "true").toLowerCase() === "true");

const PREDEFINED_CITIES = [
  { id: "harare", title: "Harare" },
  { id: "bulawayo", title: "Bulawayo" },
  { id: "mutare", title: "Mutare" },
];

async function sendFlowStart(phoneNumber, flowId = DEFAULT_FLOW_ID, data = {}) {
  const apiToken = process.env.WHATSAPP_API_TOKEN;
  const phone_number_id = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;
  if (!apiToken || !phone_number_id) return { error: "missing-credentials" };

  const payloadData = {
    cities: (data.cities || PREDEFINED_CITIES).map((c) => ({ id: c.id, title: c.title })),
    suburbs: data.suburbs || [],
    propertyCategories: data.propertyCategories || [
      { id: "residential", title: "Residential" },
      { id: "commercial", title: "Commercial" },
    ],
    propertyTypes: data.propertyTypes || [
      { id: "house", title: "House" },
      { id: "flat", title: "Flat" },
      { id: "studio", title: "Studio" },
    ],
    bedrooms: data.bedrooms || [
      { id: "any", title: "Any" },
      { id: "1", title: "1" },
      { id: "2", title: "2" },
      { id: "3", title: "3" },
    ],
    ...data,
  };

  const interactivePayload = {
    messaging_product: "whatsapp",
    to: digitsOnly(phoneNumber),
    type: "interactive",
    interactive: {
      type: "flow",
      header: { type: "text", text: "Find rentals — filters" },
      body: { text: "Please press continue to SEARCH." },
      footer: { text: "Search" },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_id: String(flowId),
          flow_cta: "Search",
          flow_action: "navigate",
          flow_action_payload: {
            screen: "SEARCH",
            data: payloadData,
          },
        },
      },
    },
  };

  return whatsappPost(phone_number_id, apiToken, interactivePayload);
}

/* -------------------------
   Simple retry
   ------------------------- */
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

/* -------------------------
   Flow send wrapper (re-usable)
   ------------------------- */
async function sendFlow(toPhone, opts = {}) {
  // wrapper that calls sendFlowStart to keep payload consistent
  // returns the response from whatsappPost/sendFlowStart
  try {
    return await sendFlowStart(toPhone, DEFAULT_FLOW_ID, opts.data || {});
  } catch (e) {
    return { error: String(e) };
  }
}

/* -------------------------
   Dedupe: DB-backed if available, in-memory fallback
   ------------------------- */
const SEEN_TTL_MS = 1000 * 60 * 5; // 5 minutes
const seenMap = new Map();

function markSeenInMemory(id) {
  if (!id) return;
  seenMap.set(id, Date.now());
}

function isSeenInMemory(id) {
  if (!id) return false;
  const now = Date.now();
  // cleanup occasionally
  for (const [k, t] of seenMap) {
    if (now - t > SEEN_TTL_MS) seenMap.delete(k);
  }
  return seenMap.has(id);
}

async function isAlreadyHandledMsg(dbAvailable, msgId) {
  if (!msgId) return false;
  if (dbAvailable && typeof Message?.findOne === "function") {
    try {
      const existing = await Message.findOne({ wa_message_id: msgId, "meta.handledHiFlow": true }).lean().exec();
      return Boolean(existing);
    } catch (e) {
      // DB check failed -> treat as not handled (fall back to memory)
      return false;
    }
  }
  return isSeenInMemory(msgId);
}

async function markHandledMsg(dbAvailable, msgId) {
  if (!msgId) return;
  if (dbAvailable && typeof Message?.findOneAndUpdate === "function") {
    try {
      await Message.findOneAndUpdate(
        { wa_message_id: msgId },
        { $set: { "meta.handledHiFlow": true } },
        { upsert: true, setDefaultsOnInsert: true }
      ).exec();
      return;
    } catch (e) {
      // DB write failed -> fall back to memory marking
      markSeenInMemory(msgId);
      return;
    }
  }
  markSeenInMemory(msgId);
}

/* -------------------------
   GET handler
------------------------- */
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

/* -------------------------
   Small helper: get canonical message object + id + text
------------------------- */
function getCanonicalMessage(payload) {
  // try several common shapes
  const msg =
    payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] ||
    payload?.messages?.[0] ||
    payload?.message ||
    payload?.message_content ||
    payload?.user_message ||
    null;

  // message id candidates
  const id =
    (msg && (msg.id || msg._id || msg.message_id)) ||
    payload?.message_id ||
    payload?.wa_message_id ||
    payload?.entry?.[0]?.id ||
    null;

  // phone / from
  const from =
    (msg && (msg.from || msg.sender || msg.from_phone)) ||
    payload?.from ||
    payload?.chat_id ||
    payload?.phone_number ||
    (payload?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.wa_id) ||
    null;

  // text body
  const text =
    (msg && ((msg.text && (msg.text.body || msg.text)) || msg.body || msg.body?.text || msg?.interactive?.button_reply?.id || msg?.interactive?.button_reply?.title)) ||
    (typeof payload?.user_message === "string" ? payload.user_message : "") ||
    "";

  return { msg, id: String(id || ""), from: String(from || ""), text: String(text || "") };
}

/* -------------------------
   POST handler — patched to avoid duplicate sends and only send Flow on hi
------------------------- */
export async function POST(request) {
  console.log("[webhook] POST invoked");

  // read raw text for logging / optional signature verification
  let rawText = "";
  try {
    rawText = await request.text();
  } catch (e) {
    rawText = "";
  }

  // parse payload
  let payload = {};
  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch (e) {
      payload = {};
    }
  }

  // Optional signature validation (log but non-fatal)
  try {
    const appSecret = process.env.APP_SECRET;
    const sigHeader = request.headers.get("x-hub-signature-256") || request.headers.get("X-Hub-Signature-256");
    if (appSecret && sigHeader) {
      const expectedSig = sigHeader.startsWith("sha256=") ? sigHeader.slice(7) : sigHeader;
      const hmac = crypto.createHmac("sha256", appSecret).update(rawText).digest("hex");
      if (!crypto.timingSafeEqual(Buffer.from(expectedSig, "hex"), Buffer.from(hmac, "hex"))) {
        console.warn("[webhook] signature validation failed (hmac mismatch)");
        // continue processing, non-fatal
      }
    }
  } catch (e) {
    console.warn("[webhook] signature validation error:", e);
  }

  // Try connecting to DB but don't crash the webhook if DB is down
  let dbAvailable = true;
  try {
    await dbConnect();
  } catch (err) {
    dbAvailable = false;
    console.error("[webhook] DB connect failed (continuing without persistence):", err);
  }

  // persist raw event (best-effort — only if DB available)
  try {
    if (dbAvailable && typeof WebhookEvent?.create === "function") {
      const headersObj = Object.fromEntries(request.headers.entries());
      await WebhookEvent.create({ provider: "whatsapp", headers: headersObj, payload, receivedAt: new Date() }).catch((e) => {
        console.warn("[webhook] save raw event create() error:", e);
      });
    } else {
      console.log("[webhook] skipping WebhookEvent.create because DB unavailable");
    }
  } catch (e) {
    console.warn("[webhook] save raw event failed:", e);
  }

  // canonicalize  message
  const { msg, id: msgId, from: phone, text: parsedText } = getCanonicalMessage(payload);
  console.log("[webhook] parsedMessage:", { msgId, phone, parsedText });

  if (!msgId && !phone) {
    console.log("[webhook] no usable message id or phone — ignoring");
    return NextResponse.json({ ok: true, note: "no-id-or-phone" });
  }

  // Save incoming message best-effort (if DB available) so we have a record to update
  let savedMsg = null;
  try {
    if (dbAvailable && typeof Message?.create === "function") {
      const doc = {
        phone: digitsOnly(phone),
        from: msg?.from || "user",
        wa_message_id: msgId || null,
        type: parsedText ? "text" : "unknown",
        text: parsedText || "",
        raw: payload,
        status: null,
        meta: {},
        conversationId: payload.conversation_id || null,
      };
      // Use upsert-like behavior if wa_message_id present to avoid duplicates
      if (msgId) {
        try {
          savedMsg = await Message.findOneAndUpdate({ wa_message_id: msgId }, { $setOnInsert: doc }, { upsert: true, new: true }).exec();
        } catch (e) {
          // fallback create
          savedMsg = await Message.create(doc).catch(() => null);
        }
      } else {
        savedMsg = await Message.create(doc).catch(() => null);
      }
    } else {
      console.log("[webhook] skipping Message.create because DB unavailable");
    }
  } catch (e) {
    console.warn("[webhook] save message error (create):", e);
  }

  // 1) Deduplicate check (DB preferred, memory fallback)
  try {
    const alreadyHandled = await isAlreadyHandledMsg(dbAvailable, msgId);
    if (alreadyHandled) {
      console.log("[webhook] message already handled (dedupe) — skipping further processing", msgId);
      return NextResponse.json({ ok: true, note: "dedupe-skip" });
    }
    // mark as handled early to prevent race conditions (we'll persist this flag properly below)
    await markHandledMsg(dbAvailable, msgId);
  } catch (e) {
    console.warn("[webhook] dedupe check/mark error:", e);
    // continue — we still try to handle, but risk duplicate on failure
  }

  // 2) ONLY handle "hi"-like messages here — send FLOW once and return immediately.
  try {
    const isHi = /^(hi|hello|hey|start)$/i.test(String(parsedText || "").trim());
    if (isHi) {
      // Send Flow (best-effort). Use minimal options; you can expand payload by passing second arg.
      const sendResp = await sendFlow(phone, {});
      // Update Message doc to reflect we handled the Hi->Flow
      try {
        if (dbAvailable && savedMsg && savedMsg._id) {
          await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.handledHiFlow": true, "meta.sendResp": sendResp } }).catch(() => null);
        }
      } catch (e) {
        console.warn("[webhook] updating saved message after sending flow failed:", e);
      }

      console.log("[webhook] Flow sent for hi. resp:", sendResp);
      // IMPT — return immediately so no other code path runs and sends extra messages
      return NextResponse.json({ ok: true, note: "flow-sent-on-hi", sendResp }, { status: 200 });
    }
  } catch (e) {
    console.error("[webhook] error in hi-flow handling:", e);
    // Do not fall through to other message handling; return safe response
    return NextResponse.json({ ok: true, note: "hi-flow-error-logged" }, { status: 200 });
  }

  // If not a hi, we intentionally do NOT run the rest of the old flows here.
  // This file is patched to ensure hi -> single flow only. For other interactions,
  // re-enable specific handlers (search, menu, listing) with their own explicit guards.
  console.log("[webhook] non-hi message received — no automatic reply configured (safe no-op).");
  return NextResponse.json({ ok: true, note: "ignored-non-hi" }, { status: 200 });
}

/* -------------------------
   helper to reveal contact details (kept for completeness)
------------------------- */
async function revealContactDetails(listingId, phone) {
  try {
    const listing = await getListingById(listingId);
    if (!listing) {
      await sendText(phone, "Sorry, listing not found.");
      return;
    }
    const contactMsg = `Contact for ${listing.title}: ${listing.contactName || "Owner"} — ${listing.contactPhone || listing.phone || "N/A"}`;
    await sendText(phone, contactMsg);
  } catch (e) {
    console.warn("revealContactDetails error", e);
    try { await sendText(phone, "Sorry — couldn't fetch contact details right now."); } catch { }
  }
}
