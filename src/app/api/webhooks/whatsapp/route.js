// app/api/webhooks/whatsapp/route.js
//
// Purpose & behavior (user-visible instructions are sent at each stage):
// 1) User sends "hi" -> webhook sends SEARCH flow + an instruction text explaining how to use the form.
// 2) User submits SEARCH -> webhook runs searchPublishedListings, sends RESULTS flow AND a numbered text fallback + instructions.
// 3) User replies with a number (e.g., "1"), taps a "select_<id>" interactive button, or sends "CONTACT <id>" -> webhook finds the saved listing ID and replies with full contact + address + listing summary.
// 4) The webhook persists listingIds into Message.meta (DB) and a memory map (selectionMap) for reliability.
//
// IMPORTANT: ensure environment variables are set for sending messages:
// - WHATSAPP_API_TOKEN, WHATSAPP_PHONE_NUMBER_ID (optional for test if you only log).
//

import { NextResponse } from "next/server";
import crypto from "crypto";
import { dbConnect, WebhookEvent, Listing } from "@/lib/db";
import Message from "@/lib/Message";
import { getListingById, searchPublishedListings } from "@/lib/getListings";

export const runtime = "nodejs";

/* -------------------------
   Tiny utilities
------------------------- */
function digitsOnly(v) {
  return String(v || "").replace(/\D/g, "");
}

/* -------------------------
   WhatsApp API helpers
------------------------- */
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
  if (!apiToken || !phone_number_id) {
    console.log("[sendText] missing credentials - would have sent:", message.slice(0, 500));
    return { error: "missing-credentials" };
  }

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
  if (!apiToken || !phone_number_id) {
    console.log("[sendInteractiveButtons] missing credentials - fallback to text");
    const fallback = [
      bodyText,
      "",
      ...buttons.map((b, i) => `${i + 1}) ${b.title}`),
      "",
      "Reply with the number (e.g. 1) or the word (e.g. 'list').",
    ].join("\n");
    await sendText(phoneNumber, fallback);
    return { error: "missing-credentials" };
  }

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
   Flow helpers & config
------------------------- */
const DEFAULT_FLOW_ID = process.env.WHATSAPP_FLOW_ID || "1534021024566343";
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
      header: { type: "text", text: data.headerText || "Find rentals — filters" },
      body: { text: data.bodyText || "Please press continue to SEARCH." },
      footer: { text: data.footerText || "Search" },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_id: String(flowId),
          flow_cta: data.flow_cta || "Search",
          flow_action: "navigate",
          flow_action_payload: {
            screen: data.screen || "SEARCH",
            data: payloadData,
          },
        },
      },
    },
  };

  return whatsappPost(phone_number_id, apiToken, interactivePayload);
}

async function sendFlowNavigate(phoneNumber, screen = "RESULTS", data = {}) {
  return sendFlowStart(phoneNumber, DEFAULT_FLOW_ID, { screen, ...data });
}

/* -------------------------
   Retry helper
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
   Dedupe (DB-backed, memory fallback)
------------------------- */
const SEEN_TTL_MS = 1000 * 60 * 5;
const seenMap = new Map();
function markSeenInMemory(id) { if (!id) return; seenMap.set(id, Date.now()); }
function isSeenInMemory(id) {
  if (!id) return false;
  const now = Date.now();
  for (const [k, t] of seenMap) if (now - t > SEEN_TTL_MS) seenMap.delete(k);
  return seenMap.has(id);
}
async function isAlreadyHandledMsg(dbAvailable, msgId) {
  if (!msgId) return false;
  if (dbAvailable && typeof Message?.findOne === "function") {
    try {
      const existing = await Message.findOne({ wa_message_id: msgId, "meta.handledHiFlow": true }).lean().exec();
      return Boolean(existing);
    } catch (e) {
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
      markSeenInMemory(msgId);
      return;
    }
  }
  markSeenInMemory(msgId);
}

/* -------------------------
   In-memory selection fallback & reliability map
   phone -> [listingId1, listingId2, ...]
   NOTE: we always set this when sending RESULTS to boost reliability
------------------------- */
const selectionMap = new Map();

/* -------------------------
   Safe nested getter
------------------------- */
function _safeGet(obj, pathArr) {
  try {
    return pathArr.reduce((o, k) => (o && o[k] != null ? o[k] : undefined), obj);
  } catch (e) {
    return undefined;
  }
}

/* -------------------------
   Flow detection + flow data parsing
------------------------- */
function detectRequestedScreen(rawPayload = {}, decryptedPayload = {}) {
  const v = rawPayload?.entry?.[0]?.changes?.[0]?.value || rawPayload || {};
  const interactiveType = _safeGet(v, ["messages", 0, "interactive", "type"]);
  if (interactiveType === "nfm_reply") return "SEARCH";

  const candidates = [
    _safeGet(v, ["data_exchange", "screen"]),
    _safeGet(v, ["flow", "screen"]),
    _safeGet(v, ["action", "payload", "screen"]),
    _safeGet(v, ["data", "screen"]),
    _safeGet(v, ["data_exchange"]),
    _safeGet(v, ["flow"]),
    _safeGet(v, ["action"]),
    _safeGet(v, ["data"]),
    _safeGet(v, ["messages", 0, "interactive", "flow", "screen"]),
    _safeGet(v, ["messages", 0, "interactive", "flow"])
  ];

  const flowData = getFlowDataFromPayload(rawPayload);
  const hasSearchFields = !!(flowData && (flowData.city || flowData.selected_city || flowData.suburb || flowData.selected_suburb || flowData.q || flowData.min_price || flowData.max_price));
  if (hasSearchFields) return "SEARCH";

  for (const c of candidates) {
    if (!c) continue;
    if (typeof c === "string") {
      const s = c.trim();
      if (s) return s.toUpperCase();
    } else if (typeof c === "object") {
      if (c.screen && typeof c.screen === "string") return String(c.screen).toUpperCase();
      if (c.name && typeof c.name === "string") return String(c.name).toUpperCase();
      const keys = Object.keys(c);
      if (keys.includes("city") || keys.includes("selected_city") || keys.includes("q") || keys.includes("min_price")) return "SEARCH";
    }
  }
  return null;
}

function getFlowDataFromPayload(payload) {
  try {
    const v = payload?.entry?.[0]?.changes?.[0]?.value || payload || {};

    const nfmJson = _safeGet(v, ["messages", 0, "interactive", "nfm_reply", "response_json"]);
    if (nfmJson && typeof nfmJson === "string") {
      try {
        const parsed = JSON.parse(nfmJson);
        if (parsed && typeof parsed === "object") return parsed;
      } catch (e) { /* ignore */ }
    }

    const msgInteractiveFlowData = _safeGet(v, ["messages", 0, "interactive", "flow", "data"]) ||
      _safeGet(v, ["messages", 0, "interactive", "data"]) ||
      _safeGet(v, ["messages", 0, "interactive"]);

    if (msgInteractiveFlowData && typeof msgInteractiveFlowData === "object") return msgInteractiveFlowData;

    const candidates = [
      _safeGet(v, ["data_exchange", "data"]),
      _safeGet(v, ["data_exchange"]),
      _safeGet(v, ["flow", "data"]),
      _safeGet(v, ["flow"]),
      _safeGet(v, ["data"]),
      payload?.data
    ];

    for (const c of candidates) {
      if (!c || typeof c !== "object") continue;
      const out = {};
      const maybe = (k) => c[k] ?? c[String(k)] ?? undefined;
      out.city = maybe("city") ?? maybe("selected_city");
      out.suburb = maybe("suburb") ?? maybe("selected_suburb");
      out.property_category = maybe("property_category") ?? maybe("selected_category");
      out.property_type = maybe("property_type") ?? maybe("selected_type");
      out.bedrooms = maybe("bedrooms") ?? maybe("selected_bedrooms");
      out.min_price = maybe("min_price") ?? maybe("minPrice") ?? maybe("min");
      out.max_price = maybe("max_price") ?? maybe("maxPrice") ?? maybe("max");
      out.q = maybe("q") ?? maybe("keyword") ?? maybe("query");
      Object.assign(out, c);
      return out;
    }

    return {};
  } catch (e) {
    return {};
  }
}

/* -------------------------
   Normalize incoming message
------------------------- */
function getCanonicalMessage(payload) {
  const msg = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] ||
    payload?.messages?.[0] ||
    payload?.message ||
    payload?.message_content ||
    payload?.user_message ||
    null;

  const id = (msg && (msg.id || msg._id || msg.message_id)) ||
    payload?.message_id ||
    payload?.wa_message_id ||
    payload?.entry?.[0]?.id ||
    null;

  const fromContact = payload?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.wa_id;
  const from =
    (msg && (msg.from || msg.sender || msg.from_phone)) ||
    fromContact ||
    payload?.from ||
    payload?.chat_id ||
    payload?.phone_number ||
    null;

  const text =
    (msg && ((msg.text && (msg.text.body || msg.text)) || msg.body || msg.body?.text || msg?.interactive?.button_reply?.id || msg?.interactive?.button_reply?.title)) ||
    (typeof payload?.user_message === "string" ? payload.user_message : "") ||
    "";

  return { msg, id: String(id || ""), from: String(from || ""), text: String(text || "") };
}

/* -------------------------
   GET handler (webhook verify)
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
   POST handler: main flow
------------------------- */
export async function POST(request) {
  console.log("[webhook] POST invoked");

  // 1) Read raw body
  let rawText = "";
  try { rawText = await request.text(); } catch (e) { rawText = ""; }

  let payload = {};
  if (rawText) {
    try { payload = JSON.parse(rawText); } catch (e) { payload = {}; }
  }

  // 2) Log snippet
  try { console.log("[webhook] payload snippet:", JSON.stringify(payload, null, 2).slice(0, 12000)); } catch (e) { /* ignore */ }

  // 3) Optional signature validation (non-fatal)
  try {
    const appSecret = process.env.APP_SECRET;
    const sigHeader = request.headers.get("x-hub-signature-256") || request.headers.get("X-Hub-Signature-256");
    if (appSecret && sigHeader) {
      const expectedSig = sigHeader.startsWith("sha256=") ? sigHeader.slice(7) : sigHeader;
      const hmac = crypto.createHmac("sha256", appSecret).update(rawText).digest("hex");
      if (!crypto.timingSafeEqual(Buffer.from(expectedSig, "hex"), Buffer.from(hmac, "hex"))) {
        console.warn("[webhook] signature validation failed (hmac mismatch)");
      }
    }
  } catch (e) { console.warn("[webhook] signature validation error:", e); }

  // 4) DB connect (best-effort)
  let dbAvailable = true;
  try { await dbConnect(); } catch (err) { dbAvailable = false; console.error("[webhook] DB connect failed (continuing without persistence):", err); }

  // 5) Persist raw event (best-effort)
  try {
    if (dbAvailable && typeof WebhookEvent?.create === "function") {
      const headersObj = Object.fromEntries(request.headers.entries());
      await WebhookEvent.create({ provider: "whatsapp", headers: headersObj, payload, receivedAt: new Date() }).catch((e) => {
        console.warn("[webhook] save raw event create() error:", e);
      });
    } else {
      console.log("[webhook] skipping WebhookEvent.create because DB unavailable");
    }
  } catch (e) { console.warn("[webhook] save raw event failed:", e); }

  // 6) Canonicalize incoming message
  const { msg, id: msgId, from: phone, text: parsedText } = getCanonicalMessage(payload);
  console.log("[webhook] parsedMessage:", { msgId, phone, parsedText });

  if (!msgId && !phone) {
    console.log("[webhook] no usable message id or phone — ignoring");
    return NextResponse.json({ ok: true, note: "no-id-or-phone" });
  }

  // 7) Save incoming Message (best-effort)
  let savedMsg = null;
  try {
    if (dbAvailable && typeof Message?.create === "function") {
      const doc = {
        phone: digitsOnly(phone),
        from: msg?.from || "user",
        wa_message_id: msgId || null,
        type: parsedText ? "text" : "interactive",
        text: parsedText || "",
        raw: payload,
        status: null,
        meta: {},
        conversationId: payload.conversation_id || null,
      };
      if (msgId) {
        try {
          savedMsg = await Message.findOneAndUpdate({ wa_message_id: msgId }, { $setOnInsert: doc }, { upsert: true, new: true }).exec();
        } catch (e) {
          savedMsg = await Message.create(doc).catch(() => null);
        }
      } else {
        savedMsg = await Message.create(doc).catch(() => null);
      }
    } else {
      console.log("[webhook] skipping Message.create because DB unavailable");
    }
  } catch (e) { console.warn("[webhook] save message error (create):", e); }

  // 8) Fetch lastMeta for this phone (DB), fallback to memory map
  let lastMeta = null;
  try {
    if (dbAvailable && typeof Message?.findOne === "function") {
      const doc = await Message.findOne({ phone: digitsOnly(phone), "meta.state": { $exists: true } })
        .sort({ createdAt: -1 })
        .lean()
        .exec();
      lastMeta = doc?.meta || null;
    }
  } catch (e) { console.warn("[webhook] lastMeta lookup failed:", e); lastMeta = null; }

  try {
    if (!lastMeta) {
      const memIds = selectionMap.get(digitsOnly(phone));
      if (memIds && Array.isArray(memIds) && memIds.length) {
        lastMeta = { state: "AWAITING_LIST_SELECTION", listingIds: memIds };
      }
    }
  } catch (e) { /* ignore */ }

  // 9) Dedupe
  try {
    const alreadyHandled = await isAlreadyHandledMsg(dbAvailable, msgId);
    if (alreadyHandled) {
      console.log("[webhook] message already handled (dedupe) — skipping further processing", msgId);
      return NextResponse.json({ ok: true, note: "dedupe-skip" });
    }
    await markHandledMsg(dbAvailable, msgId);
  } catch (e) { console.warn("[webhook] dedupe check/mark error:", e); }

  /* -------------------------
     10) AWAITING_LIST_SELECTION handler
  ------------------------- */
  try {
    if (lastMeta && lastMeta.state === "AWAITING_LIST_SELECTION") {
      const raw = String(parsedText || "").trim();

      // If caller's meta didn't include listingIds, also try memory map
      const idsFromMeta = lastMeta.listingIds || selectionMap.get(digitsOnly(phone)) || [];

      // interactive reply id: select_<id>
      if (/^select_/.test(raw)) {
        const listingId = raw.split("_")[1];
        if (listingId) {
          await revealContactDetails(listingId, phone);
          try {
            if (dbAvailable && savedMsg && savedMsg._id) {
              await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.state": "CONTACT_REVEALED", "meta.listingIdSelected": listingId } }).catch(() => null);
            }
          } catch (e) { /* ignore */ }
          // clear memory map for phone (short-lived)
          selectionMap.delete(digitsOnly(phone));
          return NextResponse.json({ ok: true, note: "selection-handled-interactive" }, { status: 200 });
        }
      }

      // numeric selection
      if (/^[1-9]\d*$/.test(raw)) {
        const idx = parseInt(raw, 10) - 1;
        const ids = idsFromMeta || [];
        if (idx >= 0 && idx < ids.length) {
          const listingId = ids[idx];
          await revealContactDetails(listingId, phone);
          try {
            if (dbAvailable && savedMsg && savedMsg._id) {
              await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.state": "CONTACT_REVEALED", "meta.listingIdSelected": listingId } }).catch(() => null);
            }
          } catch (e) { /* ignore */ }
          selectionMap.delete(digitsOnly(phone));
          return NextResponse.json({ ok: true, note: "selection-handled-number" }, { status: 200 });
        } else {
          await sendText(phone, `Invalid selection. Reply with a number between 1 and ${idsFromMeta.length || "N"}.`);
          return NextResponse.json({ ok: true, note: "selection-invalid" }, { status: 200 });
        }
      }

      // CONTACT <id> textual command
      const m = raw.match(/^contact\s+(.+)$/i);
      if (m) {
        const listingId = m[1].trim();
        await revealContactDetails(listingId, phone);
        try {
          if (dbAvailable && savedMsg && savedMsg._id) {
            await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.state": "CONTACT_REVEALED", "meta.listingIdSelected": listingId } }).catch(() => null);
          }
        } catch (e) { /* ignore */ }
        selectionMap.delete(digitsOnly(phone));
        return NextResponse.json({ ok: true, note: "selection-handled-contactcmd" }, { status: 200 });
      }

      // Not recognized -> instruct how to reply
      await sendText(phone, "To view contact details reply with the number of the listing (e.g. 1) or tap a result. Or send: CONTACT <LISTING_ID>.");
      return NextResponse.json({ ok: true, note: "selection-expected-number" }, { status: 200 });
    }
  } catch (e) {
    console.warn("[webhook] AWAITING_LIST_SELECTION error:", e);
  }

  /* -------------------------
     11) Greeting - user said "hi" -> open SEARCH flow
  ------------------------- */
  try {
    const isHi = /^(hi|hello|hey|start)$/i.test(String(parsedText || "").trim());
    if (isHi) {
      const resp = await sendFlowNavigate(phone, "SEARCH", {
        headerText: "Find rentals — filters",
        bodyText: "Please press continue to SEARCH.",
        footerText: "Search",
        data: {
          cities: PREDEFINED_CITIES,
          suburbs: [
            { id: "any", title: "Any" },
            { id: "borrowdale", title: "Borrowdale" },
            { id: "mount_pleasant", title: "Mount Pleasant" },
            { id: "avondale", title: "Avondale" },
          ],
        },
      });
      console.log("[webhook] sendFlowNavigate(SEARCH) response:", resp);

      // user-facing instruction text (important — user saw this missing previously)
      const instruct = [
        "Search opened ✅",
        "Fill the form to search for rentals (city, suburb, budget).",
        "When results appear you can:",
        "• Tap a result, OR",
        "• Reply with the result number (e.g. 1) to view contact details, OR",
        "• Reply: CONTACT <LISTING_ID> (if you have the ID).",
      ].join("\n");

      try { await sendText(phone, instruct); } catch (e) { /* ignore */ }

      if (dbAvailable && savedMsg && savedMsg._id) {
        await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.sentSearchFlow": true, "meta.sendResp": resp } }).catch(() => null);
      }
      return NextResponse.json({ ok: true, note: "search-flow-sent", sendResp: resp }, { status: 200 });
    }
  } catch (e) {
    console.error("[webhook] error sending search flow:", e);
    return NextResponse.json({ ok: true, note: "search-flow-error-logged" }, { status: 200 });
  }

  /* -------------------------
     12) Handle SEARCH form submission -> run search -> send RESULTS
  ------------------------- */
  try {
    const requestedScreen = detectRequestedScreen(payload, msg || {});
    console.log("[webhook] detectRequestedScreen ->", requestedScreen);

    if (requestedScreen === "SEARCH") {
      const flowData = getFlowDataFromPayload(payload);
      console.log("[webhook] flowData (SEARCH):", flowData);

      const q = String(flowData.q || flowData.keyword || flowData.query || `${flowData.suburb || ""} ${flowData.city || ""}`).trim();
      const minPrice = flowData.min_price || flowData.minPrice || flowData.min || null;
      const maxPrice = flowData.max_price || flowData.maxPrice || flowData.max || null;
      const minP = minPrice ? Number(String(minPrice).replace(/[^\d.]/g, "")) : null;
      const maxP = maxPrice ? Number(String(maxPrice).replace(/[^\d.]/g, "")) : null;

      // perform search
      let results = { listings: [], total: 0 };
      try {
        results = await (async () => {
          try {
            return await searchPublishedListings({ q, minPrice: minP, maxPrice: maxP, perPage: 6 });
          } catch (e) {
            console.warn("[webhook] searchPublishedListings failed:", e);
            return { listings: [], total: 0 };
          }
        })();
      } catch (e) {
        console.warn("[webhook] searchPublishedListings unexpected error:", e);
      }

      const listings = (results.listings || []).slice(0, 6).map((l) => ({
        id: String(l._id || l.id || ""),
        title: l.title || "",
        suburb: l.suburb || "",
        pricePerMonth: l.pricePerMonth || l.price || 0,
        bedrooms: l.bedrooms || "",
      }));

      // build a short listing text (top 6)
      const numberedText = (results.listings || []).slice(0, 6).map((l, i) =>
        `${i + 1}) ${l.title} — ${l.suburb || ""} — $${l.pricePerMonth || l.price || "N/A"}`
      ).join("\n\n") || "No matches found. Try a broader area or higher budget.";

      const listingText = (results.listings || []).map((l, i) => `${i + 1}) ${l.title} — ${l.suburb || ""} — $${l.pricePerMonth || l.price || "N/A"} — ID:${String(l._id || l.id || i)}`).slice(0, 3);

      const resultsPayloadData = {
        resultsCount: results.total || listings.length,
        listings,
        querySummary: `Top ${listings.length} results`,
        listingText0: listingText[0] || "",
        listingText1: listingText[1] || "",
        listingText2: listingText[2] || "",
        hasResult0: Boolean(listingText[0]),
        hasResult1: Boolean(listingText[1]),
        hasResult2: Boolean(listingText[2]),
        city: flowData.city || flowData.selected_city || "",
        suburb: flowData.suburb || flowData.selected_suburb || "",
        property_category: flowData.property_category || flowData.selected_category || "",
        property_type: flowData.property_type || flowData.selected_type || "",
        bedrooms: flowData.bedrooms || flowData.selected_bedrooms || "",
        min_price: Number(flowData.min_price || flowData.minPrice || 0),
        max_price: Number(flowData.max_price || flowData.maxPrice || 0),
        q: q || "",
        cities: PREDEFINED_CITIES,
      };

      // send RESULTS flow
      const resp = await sendFlowNavigate(phone, "RESULTS", { data: resultsPayloadData, headerText: "Search results", bodyText: listingText.join("\n\n"), footerText: "Done" });
      console.log("[webhook] sendFlowNavigate(RESULTS) response:", resp);

      // Persist listingIds and set AWATING_LIST_SELECTION (DB + in-memory)
      try {
        const ids = (results.listings || []).slice(0, 6).map((l) => String(l._id || l.id || ""));
        // ALWAYS set in-memory mapping for immediate reliability
        try { selectionMap.set(digitsOnly(phone), ids); } catch (e) { /* ignore */ }

        if (dbAvailable && savedMsg && savedMsg._id) {
          await Message.findByIdAndUpdate(
            savedMsg._id,
            { $set: { "meta.state": "AWAITING_LIST_SELECTION", "meta.listingIds": ids, "meta.searchResultsCount": results.total || ids.length, "meta.sendResp_resultsFlow": resp } },
            { upsert: true }
          ).catch(() => null);
        }
      } catch (e) {
        console.warn("[webhook] saving listingIds to message meta failed:", e);
      }

      // user-facing fallback: send numbered text listing + instructions (ensures user knows what to do)
      try {
        await sendText(phone, numberedText);
        const instructions = [
          "",
          "To view contact details:",
          "• Reply with the number of a listing (e.g. 1) OR",
          "• Tap a result in the flow OR",
          "• Reply: CONTACT <LISTING_ID> (e.g. CONTACT 60df1234abcd...)",
        ].join("\n");
        await sendText(phone, instructions);
      } catch (e) {
        console.warn("[webhook] sending fallback numbered list or instructions failed:", e);
      }

      return NextResponse.json({ ok: true, note: "search-handled-results-sent", sendResp: resp }, { status: 200 });
    }
  } catch (e) {
    console.error("[webhook] error handling flow SEARCH -> RESULTS:", e);
    return NextResponse.json({ ok: true, note: "flow-search-error-logged" }, { status: 200 });
  }

  // 13) Default safe no-op
  console.log("[webhook] non-hi, non-search message received — no automatic reply configured (safe no-op).");
  return NextResponse.json({ ok: true, note: "ignored-non-hi-non-search" }, { status: 200 });
}

/* -------------------------
   revealContactDetails - robust lookup + full listing summary
   - tries getListingById -> Listing.findById fallback
   - sends contact details, address/suburb, price, bedrooms, property type/category, description, features, lister phone, contact WhatsApp/email, and images count note
------------------------- */
async function revealContactDetails(listingId, phone) {
  try {
    // Try helper first (if you've implemented a custom helper)
    let listing = null;
    try {
      listing = await getListingById(listingId);
    } catch (e) {
      listing = null;
    }

    // fallback to direct DB lookup
    try {
      if (!listing && typeof Listing?.findById === "function") {
        listing = await Listing.findById(listingId).lean().exec().catch(() => null);
      }
    } catch (e) {
      // ignore
    }

    // fallback: try findOne by id string (some systems store string ids)
    try {
      if (!listing && typeof Listing?.findOne === "function") {
        listing = await Listing.findOne({ _id: listingId }).lean().exec().catch(() => null);
      }
    } catch (e) { /* ignore */ }

    if (!listing) {
      await sendText(phone, "Sorry, listing not found.");
      return;
    }

    // Build full human-friendly summary using your schema fields
    const title = listing.title || "Listing";
    const suburb = listing.suburb || "";
    const price = listing.pricePerMonth != null ? `$${listing.pricePerMonth}` : (listing.price != null ? `$${listing.price}` : "N/A");
    const bedrooms = listing.bedrooms != null ? `${listing.bedrooms} bed(s)` : "";
    const propertyType = listing.propertyType || listing.property_type || "";
    const propertyCategory = listing.propertyCategory || listing.property_category || "";
    const deposit = listing.deposit != null ? `$${listing.deposit}` : null;
    const description = listing.description ? `${String(listing.description).slice(0, 800)}` : "";
    const features = Array.isArray(listing.features) ? listing.features.filter(Boolean) : [];
    const images = Array.isArray(listing.images) ? listing.images.filter(Boolean) : [];

    const contactName = listing.contactName || listing.ownerName || "Owner";
    const contactPhone = listing.contactPhone || listing.phone || listing.listerPhoneNumber || "N/A";
    const contactWhatsApp = listing.contactWhatsApp || "";
    const contactEmail = listing.contactEmail || "";

    // Send contact + primary listing info first
    const contactMsgLines = [
      `Contact for: ${title}`,
      suburb ? `Suburb: ${suburb}` : null,
      propertyType ? `Type: ${propertyType}` : null,
      propertyCategory ? `Category: ${propertyCategory}` : null,
      bedrooms ? `Bedrooms: ${bedrooms}` : null,
      `Price: ${price}`,
      deposit ? `Deposit: ${deposit}` : null,
      "",
      `Contact: ${contactName}`,
      `Phone: ${contactPhone}`,
    ].filter(Boolean);

    if (contactWhatsApp) contactMsgLines.push(`WhatsApp: ${contactWhatsApp}`);
    if (contactEmail) contactMsgLines.push(`Email: ${contactEmail}`);

    await sendText(phone, contactMsgLines.join("\n"));

    // Send description and features (if any)
    if (description) {
      await sendText(phone, `Description:\n${description}`);
    }

    if (features && features.length) {
      await sendText(phone, `Features:\n• ${features.join("\n• ")}`);
    }

    // Send images note
    if (images.length) {
      await sendText(phone, `Photos: ${images.length} image(s) available.`);
    }

    // Provide instructions to next actions (view more or request contact again)
    const nextSteps = [
      "",
      "Need directions or to contact the lister? Reply: CALL or send the number above.",
      "Or reply with another result number (e.g. 2) to view another listing.",
    ].join("\n");
    await sendText(phone, nextSteps);

  } catch (e) {
    console.warn("revealContactDetails error", e);
    try { await sendText(phone, "Sorry — couldn't fetch contact details right now."); } catch { }
  }
}
