// app/api/webhooks/whatsapp/route.js
//
// Purpose:
//  - Receive WhatsApp webhook events (Flow & normal messages)
//  - Send SEARCH flow when user says "hi"
//  - Handle SEARCH submissions, run a listings search and send RESULTS flow
//  - Persist listing IDs (DB or memory fallback) and set state AWATING_LIST_SELECTION
//  - Accept numeric reply (e.g. "1"), interactive reply (e.g. "select_<id>"), or "CONTACT <id>"
//    and reply with contact details + address for the selected listing.
//
// IMPORTANT ENV VARS (set in your hosting env):
//  - WHATSAPP_API_TOKEN           (Meta Graph API token) — optional for test mode
//  - WHATSAPP_PHONE_NUMBER_ID     (phone number id for Graph requests)
//  - WHATSAPP_FLOW_ID             (flow id you use for Meta flows)
//  - WHATSAPP_WEBHOOK_VERIFY_TOKEN (value used in GET verify handshake)
//  - APP_SECRET                   (optional — used to validate x-hub-signature-256)
//

// runtime
import { NextResponse } from "next/server";
import crypto from "crypto";
import { dbConnect, WebhookEvent, Listing } from "@/lib/db";
import Message from "@/lib/Message";
import { getListingById, searchPublishedListings } from "@/lib/getListings";

export const runtime = "nodejs";

/* -------------------------
   Helper functions (small utilities)
   - digitsOnly: cleans phone numbers
   - whatsappPost / sendText / sendInteractiveButtons: wrappers to call Meta Graph API
   - sendFlowStart / sendFlowNavigate: sends flow-type interactions (SEARCH/RESULTS)
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
  // Sends a plain text message via WhatsApp API (best-effort).
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
  // Sends up to 3 interactive reply buttons. If API call fails, sends a text fallback with numbered options.
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
    // graceful fallback to text listing
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
   Flow config & helpers
   - DEFAULT_FLOW_ID: flow id for Meta flows (you can override)
   - PREDEFINED_CITIES: used to populate SEARCH form data
   - sendFlowStart: sends a flow message (SEARCH or navigate to RESULTS)
   - sendFlowNavigate: convenience wrapper to navigate to a screen
   ------------------------- */

const DEFAULT_FLOW_ID = process.env.WHATSAPP_FLOW_ID || "1534021024566343";
const ENABLE_SEARCH_FLOW = (String(process.env.ENABLE_SEARCH_FLOW || "true").toLowerCase() === "true");

const PREDEFINED_CITIES = [
  { id: "harare", title: "Harare" },
  { id: "bulawayo", title: "Bulawayo" },
  { id: "mutare", title: "Mutare" },
];

async function sendFlowStart(phoneNumber, flowId = DEFAULT_FLOW_ID, data = {}) {
  // Build a flow payload for Meta and send it.
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
  // Convenience: send a flow configured to navigate to the specified screen
  return sendFlowStart(phoneNumber, DEFAULT_FLOW_ID, { screen, ...data });
}

/* -------------------------
   Retry helper (small utility)
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
   Message dedupe (DB-backed with memory fallback)
   - isAlreadyHandledMsg / markHandledMsg: avoid processing the same incoming msg twice
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
   In-memory selection fallback:
   - selectionMap maps phone -> recent listingIds
   - used when DB is not available (stateless / quick testing)
   ------------------------- */
const selectionMap = new Map(); // key: phone (digits only) -> array of listingIds

/* -------------------------
   Small safe getter for nested objects
   ------------------------- */
function _safeGet(obj, pathArr) {
  try {
    return pathArr.reduce((o, k) => (o && o[k] != null ? o[k] : undefined), obj);
  } catch (e) {
    return undefined;
  }
}

/* -------------------------
   Detect flow screen (SEARCH / RESULTS)
   - This inspects possible shapes of Meta's flow payloads (nfm_reply, flow.data, data_exchange, etc.)
   - Returns uppercase screen name (e.g., "SEARCH") or null.
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

/* -------------------------
   Parse flow form data from payload (handles different shapes)
   - Looks for interactive.nfm_reply.response_json, interactive.flow.data, data_exchange.data, etc.
   - Returns normalized object with keys like city/suburb/min_price/max_price/q
   ------------------------- */
function getFlowDataFromPayload(payload) {
  try {
    const v = payload?.entry?.[0]?.changes?.[0]?.value || payload || {};

    // 1) nfm_reply.response_json (stringified JSON)
    const nfmJson = _safeGet(v, ["messages", 0, "interactive", "nfm_reply", "response_json"]);
    if (nfmJson && typeof nfmJson === "string") {
      try {
        const parsed = JSON.parse(nfmJson);
        if (parsed && typeof parsed === "object") return parsed;
      } catch (e) { /* ignore parse error */ }
    }

    // 2) messages[0].interactive.flow.data or similar
    const msgInteractiveFlowData = _safeGet(v, ["messages", 0, "interactive", "flow", "data"]) ||
      _safeGet(v, ["messages", 0, "interactive", "data"]) ||
      _safeGet(v, ["messages", 0, "interactive"]);

    if (msgInteractiveFlowData && typeof msgInteractiveFlowData === "object") return msgInteractiveFlowData;

    // 3) data_exchange.data or payload.data etc.
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
   getCanonicalMessage - normalize incoming message shapes
   - returns: { msg, id, from, text }
   - used to extract message id, phone, and text reliably
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
   GET handler: webhook verification (Meta handshake)
   - Check hub.mode, hub.verify_token, hub.challenge
   - Return challenge when token matches expected token
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
    // Handshake successful — return challenge string to Meta
    return new Response(challenge, { status: 200, headers: { "Cache-Control": "no-store" } });
  }

  return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
}

/* -------------------------
   POST handler: main webhook entry point
   Stages (with instructions in comments):
   1) read raw body
   2) optional signature validation (non-fatal)
   3) connect to DB (best-effort)
   4) persist raw event (best-effort)
   5) canonicalize message (id, from phone, text)
   6) save incoming Message doc (best-effort)
   7) retrieve lastMeta (state) for that phone (DB or in-memory)
   8) dedupe (prevent double-processing)
   9) If lastMeta.state === 'AWAITING_LIST_SELECTION' -> handle numeric / select_ / CONTACT
   10) If message is a greeting (hi) -> send SEARCH flow
   11) If payload contains SEARCH form submission -> run search, send RESULTS flow, persist listingIds, set AWATING_LIST_SELECTION
   12) else -> safe no-op
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

  // 2) Log a snippet for debugging (don't leak secrets)
  try {
    const snippet = JSON.stringify(payload, null, 2).slice(0, 12000);
    console.log("[webhook] raw payload snippet:\n", snippet);
  } catch (e) {
    console.log("[webhook] failed to stringify raw payload for logging");
  }

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
  } catch (e) {
    console.warn("[webhook] signature validation error:", e);
  }

  // 4) DB connect (best-effort)
  let dbAvailable = true;
  try { await dbConnect(); } catch (err) { dbAvailable = false; console.error("[webhook] DB connect failed (continuing without persistence):", err); }

  // 5) Persist raw event (best-effort) to WebhookEvent collection
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

  // 6) Canonicalize message to get id/from/text
  const { msg, id: msgId, from: phone, text: parsedText } = getCanonicalMessage(payload);
  console.log("[webhook] parsedMessage:", { msgId, phone, parsedText });

  if (!msgId && !phone) {
    console.log("[webhook] no usable message id or phone — ignoring");
    return NextResponse.json({ ok: true, note: "no-id-or-phone" });
  }

  // 7) Save incoming message (best-effort)
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

  // 8) Fetch lastMeta for this phone (used for selection state)
  let lastMeta = null;
  try {
    if (dbAvailable && typeof Message?.findOne === "function") {
      const doc = await Message.findOne({ phone: digitsOnly(phone), "meta.state": { $exists: true } })
        .sort({ createdAt: -1 })
        .lean()
        .exec();
      lastMeta = doc?.meta || null;
    }
  } catch (e) {
    console.warn("[webhook] lastMeta lookup failed:", e);
    lastMeta = null;
  }

  // If DB not available, check in-memory selectionMap for fallback
  try {
    if (!lastMeta) {
      const memIds = selectionMap.get(digitsOnly(phone));
      if (memIds && Array.isArray(memIds) && memIds.length) {
        lastMeta = { state: "AWAITING_LIST_SELECTION", listingIds: memIds };
      }
    }
  } catch (e) {
    // ignore
  }

  // 9) Dedupe incoming message (avoid duplicate processing)
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

  /* -------------------------
     10) AWAITING_LIST_SELECTION handler:
     - If lastMeta.state === "AWAITING_LIST_SELECTION":
         * Accept "select_<id>" (interactive button id)
         * Accept numeric replies "1", "2"... to map to listingIds saved in meta or memory
         * Accept "CONTACT <id>"
       After sending the contact details, update message meta to CONTACT_REVEALED and clear in-memory map.
     ------------------------- */
  try {
    if (lastMeta && lastMeta.state === "AWAITING_LIST_SELECTION") {
      const raw = String(parsedText || "").trim();

      // interactive reply id form: select_<listingId>
      if (/^select_/.test(raw)) {
        const listingId = raw.split("_")[1];
        if (listingId) {
          await revealContactDetails(listingId, phone);
          try {
            if (dbAvailable && savedMsg && savedMsg._id) {
              await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.state": "CONTACT_REVEALED", "meta.listingIdSelected": listingId } }).catch(() => null);
            } else {
              selectionMap.delete(digitsOnly(phone));
            }
          } catch (e) { /* ignore */ }
          return NextResponse.json({ ok: true, note: "selection-handled-interactive" }, { status: 200 });
        }
      }

      // numeric selection: 1, 2, 3...
      if (/^[1-9]\d*$/.test(raw)) {
        const idx = parseInt(raw, 10) - 1;
        const ids = lastMeta.listingIds || [];
        if (idx >= 0 && idx < ids.length) {
          const listingId = ids[idx];
          await revealContactDetails(listingId, phone);
          try {
            if (dbAvailable && savedMsg && savedMsg._id) {
              await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.state": "CONTACT_REVEALED", "meta.listingIdSelected": listingId } }).catch(() => null);
            } else {
              selectionMap.delete(digitsOnly(phone));
            }
          } catch (e) { /* ignore */ }
          return NextResponse.json({ ok: true, note: "selection-handled-number" }, { status: 200 });
        } else {
          await sendText(phone, `Invalid selection. Reply with a number between 1 and ${ids.length}.`);
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
          } else {
            selectionMap.delete(digitsOnly(phone));
          }
        } catch (e) { /* ignore */ }
        return NextResponse.json({ ok: true, note: "selection-handled-contactcmd" }, { status: 200 });
      }

      // Not recognized: instruct user how to reply
      await sendText(phone, "Please reply with the number of the listing (e.g. 1) or tap a result. Reply 'Contact <ID>' to view contact details.");
      return NextResponse.json({ ok: true, note: "selection-expected-number" }, { status: 200 });
    }
  } catch (e) {
    console.warn("[webhook] AWAITING_LIST_SELECTION error:", e);
    // continue processing
  }

  /* -------------------------
     11) Greeting - send SEARCH flow when user says "hi"
     - If user sends hi/hello/start -> we open the SEARCH flow (Flow UI)
     - This stage returns after sending the flow (no further processing)
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
     12) Handle SEARCH form submissions (Flow -> RESULTS)
     - detectRequestedScreen(payload) returns "SEARCH" for flow submissions
     - We parse the form data with getFlowDataFromPayload(payload)
     - Run searchPublishedListings(q, minPrice, maxPrice)
     - Build a resultsPayload and sendFlowNavigate(..., "RESULTS", { data: resultsPayloadData })
     - Persist listingIds into Message.meta (or selectionMap fallback) and set meta.state = "AWAITING_LIST_SELECTION"
     - Then the user can reply with numbers to request contact details
     ------------------------- */
  try {
    const requestedScreen = detectRequestedScreen(payload, msg || {});
    console.log("[webhook] detectRequestedScreen ->", requestedScreen);

    if (requestedScreen === "SEARCH") {
      // extract flow data
      const flowData = getFlowDataFromPayload(payload);
      console.log("[webhook] flowData (SEARCH):", flowData);

      // build search params
      const q = String(flowData.q || flowData.keyword || flowData.query || `${flowData.suburb || ""} ${flowData.city || ""}`).trim();
      const minPrice = flowData.min_price || flowData.minPrice || flowData.min || null;
      const maxPrice = flowData.max_price || flowData.maxPrice || flowData.max || null;
      const minP = minPrice ? Number(String(minPrice).replace(/[^\d.]/g, "")) : null;
      const maxP = maxPrice ? Number(String(maxPrice).replace(/[^\d.]/g, "")) : null;

      // perform search (use your existing searchPublishedListings helper)
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

      // prepare results for the flow payload
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

      // send RESULTS flow to user
      const resp = await sendFlowNavigate(phone, "RESULTS", { data: resultsPayloadData, headerText: "Search results", bodyText: listingText.join("\n\n"), footerText: "Done" });
      console.log("[webhook] sendFlowNavigate(RESULTS) response:", resp);

      // persist listingIds and set state so numeric reply can reference them
      try {
        const ids = (results.listings || []).slice(0, 6).map((l) => String(l._id || l.id || ""));
        if (dbAvailable && savedMsg && savedMsg._id) {
          await Message.findByIdAndUpdate(
            savedMsg._id,
            { $set: { "meta.state": "AWAITING_LIST_SELECTION", "meta.listingIds": ids, "meta.searchResultsCount": results.total || ids.length, "meta.sendResp_resultsFlow": resp } },
            { upsert: true }
          ).catch(() => null);
        } else {
          // fallback: store in-memory for this phone
          try { selectionMap.set(digitsOnly(phone), (results.listings || []).slice(0, 6).map((l) => String(l._id || l.id || ""))); } catch (e) { /* ignore */ }
        }
      } catch (e) {
        console.warn("[webhook] saving listingIds to message meta failed:", e);
      }

      // fallback text in case flow fails for any reason
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

  // 13) Default safe no-op (no configured automatic reply)
  console.log("[webhook] non-hi, non-search message received — no automatic reply configured (safe no-op).");
  return NextResponse.json({ ok: true, note: "ignored-non-hi-non-search" }, { status: 200 });
}

/* -------------------------
   revealContactDetails helper
   - Fetches listing by id (via getListingById)
   - Sends contact name + phone and address/suburb to the requesting phone
   - If getListingById returns custom fields, adapt the address selection logic here
   ------------------------- */
async function revealContactDetails(listingId, phone) {
  try {
    const listing = await getListingById(listingId);
    if (!listing) {
      await sendText(phone, "Sorry, listing not found.");
      return;
    }

    // pick address from common possible fields
    const address =
      listing.address ||
      listing.formattedAddress ||
      (listing.location && (listing.location.address || listing.location.formattedAddress)) ||
      listing.suburb ||
      "";

    const contactName = listing.contactName || listing.ownerName || "Owner";
    const contactPhone = listing.contactPhone || listing.phone || listing.ownerPhone || "N/A";

    // Send contact details (first message)
    const contactMsg = `Contact for ${listing.title || "listing"}:\n${contactName}\nPhone: ${contactPhone}`;
    await sendText(phone, contactMsg);

    // Send address (second message) if available
    if (address) {
      const addressMsg = `Address: ${address}`;
      await sendText(phone, addressMsg);
    } else if (listing.suburb) {
      await sendText(phone, `Suburb: ${listing.suburb}`);
    }
  } catch (e) {
    console.warn("revealContactDetails error", e);
    try { await sendText(phone, "Sorry — couldn't fetch contact details right now."); } catch { }
  }
}
