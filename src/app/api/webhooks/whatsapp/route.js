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
   Flow helpers & config
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
   Utility safe getter
------------------------- */
function _safeGet(obj, pathArr) {
  try {
    return pathArr.reduce((o, k) => (o && o[k] != null ? o[k] : undefined), obj);
  } catch (e) {
    return undefined;
  }
}

/* -------------------------
   Detect screen (now handles nfm_reply)
------------------------- */
function detectRequestedScreen(rawPayload = {}, decryptedPayload = {}) {
  const v = rawPayload?.entry?.[0]?.changes?.[0]?.value || rawPayload || {};
  // Quick: if interactive.nfm_reply exists -> treat as SEARCH (Meta's new flow reply shape)
  const interactiveType = _safeGet(v, ["messages", 0, "interactive", "type"]);
  if (interactiveType === "nfm_reply") return "SEARCH";

  // check common explicit places
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

  // If payload contains form-like keys, infer SEARCH
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

/* -------------------------
   Extract flow form data (now parses nfm_reply.response_json)
------------------------- */
function getFlowDataFromPayload(payload) {
  try {
    const v = payload?.entry?.[0]?.changes?.[0]?.value || payload || {};

    // 1) check interactive.nfm_reply.response_json (string)
    const nfmJson = _safeGet(v, ["messages", 0, "interactive", "nfm_reply", "response_json"]);
    if (nfmJson && typeof nfmJson === "string") {
      try {
        const parsed = JSON.parse(nfmJson);
        if (parsed && typeof parsed === "object") return parsed;
      } catch (e) {
        // ignore parse error and continue
      }
    }

    // 2) messages[0].interactive.flow.data or messages[0].interactive.data
    const msgInteractiveFlowData = _safeGet(v, ["messages", 0, "interactive", "flow", "data"]) ||
      _safeGet(v, ["messages", 0, "interactive", "data"]) ||
      _safeGet(v, ["messages", 0, "interactive"]);

    if (msgInteractiveFlowData && typeof msgInteractiveFlowData === "object") return msgInteractiveFlowData;

    // 3) data_exchange.data or flow.data or value.data or data
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
      // normalize a few keys and return the object
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
   Canonical message extractor
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

  // prefer contacts[0].wa_id if present (Meta supplies contact separately)
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
   GET handler (unchanged)
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
   POST handler (patched)
------------------------- */
export async function POST(request) {
  console.log("[webhook] POST invoked");

  // read raw body
  let rawText = "";
  try { rawText = await request.text(); } catch (e) { rawText = ""; }

  let payload = {};
  if (rawText) {
    try { payload = JSON.parse(rawText); } catch (e) { payload = {}; }
  }

  // log a snippet for debugging
  try {
    const snippet = JSON.stringify(payload, null, 2).slice(0, 12000);
    console.log("[webhook] raw payload snippet:\n", snippet);
  } catch (e) {
    console.log("[webhook] failed to stringify raw payload for logging");
  }

  // signature validation (non-fatal)
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
  } catch (e) {
    console.warn("[webhook] signature validation error:", e);
  }

  // DB connect (best-effort)
  let dbAvailable = true;
  try { await dbConnect(); } catch (err) { dbAvailable = false; console.error("[webhook] DB connect failed (continuing without persistence):", err); }

  // persist raw event (best-effort)
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

  // canonicalize message
  const { msg, id: msgId, from: phone, text: parsedText } = getCanonicalMessage(payload);
  console.log("[webhook] parsedMessage:", { msgId, phone, parsedText });

  if (!msgId && !phone) {
    console.log("[webhook] no usable message id or phone — ignoring");
    return NextResponse.json({ ok: true, note: "no-id-or-phone" });
  }

  // save incoming message best-effort
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
  } catch (e) {
    console.warn("[webhook] save message error (create):", e);
  }

  // dedupe
  try {
    const alreadyHandled = await isAlreadyHandledMsg(dbAvailable, msgId);
    if (alreadyHandled) {
      console.log("[webhook] message already handled (dedupe) — skipping further processing", msgId);
      return NextResponse.json({ ok: true, note: "dedupe-skip" });
    }
    await markHandledMsg(dbAvailable, msgId);
  } catch (e) {
    console.warn("[webhook] dedupe check/mark error:", e);
  }

  // 1) Handle "hi"
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
      if (dbAvailable && savedMsg && savedMsg._id) {
        await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.sentSearchFlow": true, "meta.sendResp": resp } }).catch(() => null);
      }
      return NextResponse.json({ ok: true, note: "search-flow-sent", sendResp: resp }, { status: 200 });
    }
  } catch (e) {
    console.error("[webhook] error sending search flow:", e);
    return NextResponse.json({ ok: true, note: "search-flow-error-logged" }, { status: 200 });
  }

  // 2) Handle flow submissions (SEARCH)
  try {
    const requestedScreen = detectRequestedScreen(payload, msg || {});
    console.log("[webhook] detectRequestedScreen ->", requestedScreen);

    if (requestedScreen === "SEARCH") {
      // extract flow data (this will parse nfm_reply.response_json when present)
      const flowData = getFlowDataFromPayload(payload);
      console.log("[webhook] flowData (SEARCH):", flowData);

      // build search params
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

      // prepare results payload
      const listings = (results.listings || []).slice(0, 6).map((l) => ({
        id: l._id || l.id || "",
        title: l.title || "",
        suburb: l.suburb || "",
        pricePerMonth: l.pricePerMonth || l.price || 0,
        bedrooms: l.bedrooms || "",
      }));

      const listingText = (results.listings || []).map((l, i) => `${i + 1}) ${l.title} — ${l.suburb || ""} — $${l.pricePerMonth || l.price || "N/A"} — ID:${l._id || l.id || i}`).slice(0, 3);

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

      // send RESULTS flow and log Meta response
      const resp = await sendFlowNavigate(phone, "RESULTS", { data: resultsPayloadData, headerText: "Search results", bodyText: listingText.join("\n\n"), footerText: "Done" });
      console.log("[webhook] sendFlowNavigate(RESULTS) response:", resp);

      // persist send response to Message doc (if available)
      try {
        if (dbAvailable && savedMsg && savedMsg._id) {
          await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.searchResultsCount": results.total || listings.length, "meta.sendResp_resultsFlow": resp } }).catch(() => null);
        }
      } catch (e) {
        console.warn("[webhook] updating saved message after sending results flow failed:", e);
      }

      // fallback text if flow failed
      if (resp?.error) {
        const fallbackText = listings.length ? listings.map((l, i) => `${i + 1}) ${l.title} — ${l.suburb} — $${l.pricePerMonth}`).join("\n\n") : "No matches found. Try a broader area or higher budget.";
        try { await sendText(phone, fallbackText); } catch (e) { console.warn("[webhook] fallback sendText after flow error failed:", e); }
      }

      return NextResponse.json({ ok: true, note: "search-handled-results-sent", sendResp: resp }, { status: 200 });
    }
  } catch (e) {
    console.error("[webhook] error handling flow SEARCH -> RESULTS:", e);
    return NextResponse.json({ ok: true, note: "flow-search-error-logged" }, { status: 200 });
  }

  console.log("[webhook] non-hi, non-search message received — no automatic reply configured (safe no-op).");
  return NextResponse.json({ ok: true, note: "ignored-non-hi-non-search" }, { status: 200 });
}

/* -------------------------
   reveal contact helper
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
