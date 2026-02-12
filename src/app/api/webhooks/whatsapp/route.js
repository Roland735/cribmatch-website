// app/api/webhooks/whatsapp/route.js
//
// Full webhook for CribMatch with dedupe + flow fallback + debug logging.
// Env required (recommended):
// - WHATSAPP_API_TOKEN
// - WHATSAPP_PHONE_NUMBER_ID (or WHATSAPP_PHONE_ID)
// - WHATSAPP_FLOW_ID (optional; fallback ID included)
// - WHATSAPP_WEBHOOK_VERIFY_TOKEN
// - APP_SECRET (optional)
//
import { NextResponse } from "next/server";
import crypto from "crypto";
import { dbConnect, WebhookEvent, Listing } from "@/lib/db";
import Message from "@/lib/Message";
import { getListingById, searchPublishedListings, getListingFacets } from "@/lib/getListings";

export const runtime = "nodejs";

/* -------------------------
   DEBUG ENV LOG (remove in prod)
------------------------- */
console.log(
  "[webhook-debug] WHATSAPP_FLOW_ID:",
  !!process.env.WHATSAPP_FLOW_ID,
  "WHATSAPP_API_TOKEN:",
  !!process.env.WHATSAPP_API_TOKEN,
  "WHATSAPP_PHONE_ID:",
  !!(process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID)
);

/* -------------------------
   Utilities
------------------------- */
function digitsOnly(v) { return String(v || "").replace(/\D/g, ""); }
function _safeGet(obj, path) { try { return path.reduce((o, k) => (o && o[k] != null ? o[k] : undefined), obj); } catch (e) { return undefined; } }
function _now() { return Date.now(); }
function _hash(s) { try { return crypto.createHash("md5").update(String(s)).digest("hex"); } catch (e) { return String(s).slice(0, 128); } }
function _normalizeForHash(s) { return String(s || "").replace(/\s+/g, " ").trim(); }

/* -------------------------
   Dedupe TTLs (smaller in dev)
------------------------- */
const TTL_TEXT_MS = process.env.NODE_ENV === "production" ? 3000 : 1000;
const TTL_INTERACTIVE_MS = process.env.NODE_ENV === "production" ? 3000 : 1000;

/* -------------------------
   Send dedupe cache (phone -> Map<hash, ts>)
------------------------- */
const messageSendCache = new Map();
function _shouldSend(phone, hash, ttl = TTL_TEXT_MS) {
  if (!phone) return true;
  const p = messageSendCache.get(phone) || new Map();
  const ts = p.get(hash);
  const now = _now();
  if (ts && now - ts < ttl) {
    return false;
  }
  p.set(hash, now);
  // cleanup stale entries occasionally
  for (const [k, t] of p) if (now - t > Math.max(TTL_TEXT_MS, TTL_INTERACTIVE_MS) * 10) p.delete(k);
  messageSendCache.set(phone, p);
  return true;
}

/* -------------------------
   WhatsApp Graph wrappers
------------------------- */
async function whatsappPost(phone_number_id, token, bodyObj) {
  const url = `https://graph.facebook.com/v24.0/${phone_number_id}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(bodyObj),
  });
  try { return await res.json(); } catch (e) { return { error: "invalid-json", status: res.status }; }
}

async function sendText(phoneNumber, message) {
  const apiToken = process.env.WHATSAPP_API_TOKEN;
  const phone_number_id = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;
  const phone = digitsOnly(phoneNumber);
  if (!message || String(message).trim() === "") return { error: "empty" };

  const normalizedMessage = _normalizeForHash(message);
  const hash = _hash(`text:${normalizedMessage}`);
  if (!_shouldSend(phone, hash, TTL_TEXT_MS)) {
    console.log("[sendText] suppressed duplicate text to", phone);
    return { suppressed: true };
  }

  if (!apiToken || !phone_number_id) {
    console.log("[sendText preview]", phone, normalizedMessage.slice(0, 300));
    return { error: "missing-credentials" };
  }

  const payload = { messaging_product: "whatsapp", to: phone, type: "text", text: { body: message } };
  return whatsappPost(phone_number_id, apiToken, payload);
}

async function sendInteractiveButtons(phoneNumber, bodyText, buttons = [], opts = {}) {
  const apiToken = process.env.WHATSAPP_API_TOKEN;
  const phone_number_id = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;
  const phone = digitsOnly(phoneNumber);
  const fallbackText = `${bodyText}\n\n${buttons.map((b, i) => `${i + 1}) ${b.title}`).join("\n")}\n\nReply with the number (e.g. 1) or the command.`;
  const interactive = {
    type: "button",
    ...(opts?.headerText ? { header: { type: "text", text: String(opts.headerText).slice(0, 60) } } : {}),
    body: { text: bodyText },
    action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })) },
  };

  // use fallback text to normalize hash
  const hash = _hash(`interactive:${_normalizeForHash(fallbackText)}`);
  if (!_shouldSend(phone, hash, TTL_INTERACTIVE_MS)) {
    console.log("[sendInteractiveButtons] suppressed duplicate interactive to", phone);
    return { suppressed: true };
  }

  if (!apiToken || !phone_number_id) {
    return sendText(phoneNumber, fallbackText);
  }

  const payload = { messaging_product: "whatsapp", to: phone, type: "interactive", interactive };
  const res = await whatsappPost(phone_number_id, apiToken, payload);
  if (res?.error) {
    // fallback once to text
    await sendText(phoneNumber, fallbackText).catch(() => null);
  }
  return res;
}

async function sendInteractiveList(phoneNumber, bodyText, rows = [], opts = {}) {
  const apiToken = process.env.WHATSAPP_API_TOKEN;
  const phone_number_id = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;
  const phone = digitsOnly(phoneNumber);

  const safeRows = Array.isArray(rows) ? rows.slice(0, 10) : [];
  const fallbackText = `${bodyText}\n\n${safeRows
    .map((r, i) => {
      const id = typeof r?.id === "string" && r.id.startsWith("select_") ? r.id.slice("select_".length) : "";
      const parts = [`${i + 1}) ${r.title}`];
      if (r.description) parts.push(r.description);
      if (id) parts.push(`ID:${id}`);
      return parts.join(" — ");
    })
    .join("\n")}\n\nTap a listing above. If you can't tap, reply: contact <ID> (example: contact 60df...).`;

  const interactive = {
    type: "list",
    ...(opts?.headerText ? { header: { type: "text", text: String(opts.headerText).slice(0, 60) } } : {}),
    body: { text: String(bodyText || "").slice(0, 1024) },
    action: {
      button: String(opts?.buttonText || "Choose").slice(0, 20),
      sections: [
        {
          title: String(opts?.sectionTitle || "Results").slice(0, 24),
          rows: safeRows.map((r) => ({
            id: String(r.id || "").slice(0, 200),
            title: String(r.title || "").slice(0, 24),
            ...(r.description ? { description: String(r.description).slice(0, 72) } : {}),
          })),
        },
      ],
    },
  };

  const hash = _hash(`interactive_list:${_normalizeForHash(fallbackText)}`);
  if (!_shouldSend(phone, hash, TTL_INTERACTIVE_MS)) {
    console.log("[sendInteractiveList] suppressed duplicate interactive list to", phone);
    return { suppressed: true };
  }

  if (!apiToken || !phone_number_id) {
    return sendText(phoneNumber, fallbackText);
  }

  const payload = { messaging_product: "whatsapp", to: phone, type: "interactive", interactive };
  const res = await whatsappPost(phone_number_id, apiToken, payload);
  if (res?.error) {
    await sendText(phoneNumber, fallbackText).catch(() => null);
  }
  return res;
}

async function saveSearchContext(phone, listingIds, resultObjects, dbAvailable) {
  try {
    if (!dbAvailable) return;
    if (typeof Message?.create !== "function") return;
    await Message.create({
      phone: digitsOnly(phone),
      from: "system",
      type: "system",
      text: "SEARCH_RESULTS",
      raw: null,
      meta: {
        kind: "SEARCH_RESULTS",
        state: "AWAITING_LIST_SELECTION",
        listingIds: Array.isArray(listingIds) ? listingIds : [],
        resultObjects: Array.isArray(resultObjects) ? resultObjects : [],
      },
    });
  } catch (e) {
    console.warn("[saveSearchContext] failed", e);
  }
}

/* -------------------------
   Flow helpers (search & results)
------------------------- */
// fallback ID restored from your earlier working file
const DEFAULT_FLOW_ID = process.env.WHATSAPP_FLOW_ID || "1534021024566343";
const PREDEFINED_CITIES = [{ id: "harare", title: "Harare" }, { id: "bulawayo", title: "Bulawayo" }, { id: "mutare", title: "Mutare" }];

const FACETS_CACHE_MS = 1000 * 60 * 10;
const facetsCache = { ts: 0, value: null };
async function getListingFacetsCached() {
  const now = Date.now();
  if (facetsCache.value && now - facetsCache.ts < FACETS_CACHE_MS) return facetsCache.value;
  try {
    const v = await getListingFacets();
    facetsCache.ts = now;
    facetsCache.value = v;
    return v;
  } catch (e) {
    return facetsCache.value || null;
  }
}

function isPublishedHeaderText(text) {
  const firstLine = String(text || "").split("\n")[0].trim();
  return /^published\b/i.test(firstLine) || /^listing created\b/i.test(firstLine) || /^listing published\b/i.test(firstLine);
}

function toOptionId(prefix, title) {
  const h = _hash(`${prefix}:${String(title || "")}`);
  return `${prefix}_${h.slice(0, 10)}`;
}

function buildInstructionHeader(instructionText) {
  const raw = String(instructionText || "").trim();
  if (!raw) return "Instructions: Reply with your answer or tap Main menu.";
  if (/^instructions:/i.test(raw)) return raw;
  return `Instructions: ${raw}`;
}

async function sendTextWithInstructionHeader(phone, message, instructionText) {
  if (isPublishedHeaderText(message)) return sendText(phone, message);
  const header = buildInstructionHeader(instructionText);
  return sendText(phone, `${header}\n\n${String(message || "").trim()}`);
}

async function sendButtonsWithInstructionHeader(phone, message, buttons, instructionText, opts = {}) {
  const headerText = isPublishedHeaderText(opts?.headerText || "") ? opts.headerText : buildInstructionHeader(instructionText);
  return sendInteractiveButtons(phone, String(message || "").trim(), buttons, { headerText });
}

async function sendWithMainMenuButton(phone, message, instructionText, opts = {}) {
  const text = String(message || "").trim();
  const buttons = [{ id: "menu_main", title: "Main menu" }];
  if (text.length <= 900) {
    return sendButtonsWithInstructionHeader(phone, text, buttons, instructionText, opts);
  }
  await sendTextWithInstructionHeader(phone, text, instructionText);
  return sendButtonsWithInstructionHeader(phone, "Return to main menu:", buttons, "Tap Main menu.", opts);
}

async function sendSearchFlow(phoneNumber, data = {}) {
  const apiToken = process.env.WHATSAPP_API_TOKEN;
  const phone_number_id = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;

  if (!DEFAULT_FLOW_ID) {
    console.warn("[sendSearchFlow] no DEFAULT_FLOW_ID configured.");
    return { error: "no-flow", reason: "no-flow-id" };
  }
  if (!apiToken || !phone_number_id) {
    console.warn("[sendSearchFlow] missing WHATSAPP_API_TOKEN or PHONE_NUMBER_ID");
    return { error: "no-flow", reason: "missing-credentials" };
  }

  const facets = (!data.suburbs || (Array.isArray(data.suburbs) && data.suburbs.length === 0)) ? await getListingFacetsCached() : null;
  const suburbsFromFacets = Array.isArray(facets?.suburbs)
    ? facets.suburbs.slice(0, 250).map((s) => ({ id: toOptionId("suburb", s), title: String(s) }))
    : [];
  const suburbsByCityFromFacets = (facets && facets.suburbsByCity && typeof facets.suburbsByCity === "object")
    ? Object.keys(facets.suburbsByCity).reduce((acc, city) => {
      const list = Array.isArray(facets.suburbsByCity[city]) ? facets.suburbsByCity[city] : [];
      acc[city] = list.slice(0, 250).map((s) => ({ id: toOptionId("suburb", s), title: String(s) }));
      return acc;
    }, {})
    : {};

  const payloadData = {
    cities: (data.cities || PREDEFINED_CITIES).map((c) => ({ id: c.id, title: c.title })),
    suburbs: (Array.isArray(data.suburbs) && data.suburbs.length) ? data.suburbs : suburbsFromFacets,
    suburbsByCity: data.suburbsByCity || suburbsByCityFromFacets,
    propertyCategories: data.propertyCategories || [{ id: "residential", title: "Residential" }, { id: "commercial", title: "Commercial" }],
    propertyTypes: data.propertyTypes || [{ id: "house", title: "House" }, { id: "flat", title: "Flat" }],
    bedrooms: data.bedrooms || [{ id: "any", title: "Any" }, { id: "1", title: "1" }, { id: "2", title: "2" }],
    ...data,
  };

  const interactivePayload = {
    messaging_product: "whatsapp",
    to: digitsOnly(phoneNumber),
    type: "interactive",
    interactive: {
      type: "flow",
      header: { type: "text", text: data.headerText || "Find rentals — filters" },
      body: { text: data.bodyText || "Only City is required. Other filters are optional." },
      footer: { text: data.footerText || "Search" },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_id: String(DEFAULT_FLOW_ID),
          flow_cta: data.flow_cta || "Search",
          flow_action: "navigate",
          flow_action_payload: { screen: data.screen || "SEARCH", data: payloadData },
        },
      },
    },
  };

  console.log("[sendSearchFlow] will send flow to", digitsOnly(phoneNumber), "flow_id:", DEFAULT_FLOW_ID);

  const hash = _hash(`flow:${JSON.stringify(interactivePayload.interactive)}`);
  if (!_shouldSend(digitsOnly(phoneNumber), hash, TTL_INTERACTIVE_MS)) {
    console.log("[sendSearchFlow] suppressed duplicate flow send for", digitsOnly(phoneNumber));
    return { suppressed: true };
  }

  const res = await whatsappPost(phone_number_id, apiToken, interactivePayload).catch((e) => {
    console.warn("[sendSearchFlow] whatsappPost error:", e);
    return { error: e };
  });

  console.log("[sendSearchFlow] send response:", res && (res.error ? JSON.stringify(res) : "ok"));
  return res;
}

async function sendResultsFlow(phoneNumber, resultsPayload = {}) {
  const apiToken = process.env.WHATSAPP_API_TOKEN;
  const phone_number_id = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;
  if (!apiToken || !phone_number_id) return { error: "missing-credentials" };

  const interactivePayload = {
    messaging_product: "whatsapp",
    to: digitsOnly(phoneNumber),
    type: "interactive",
    interactive: {
      type: "flow",
      header: { type: "text", text: resultsPayload.headerText || "Instructions: Tap View" },
      body: { text: resultsPayload.bodyText || (resultsPayload.data && resultsPayload.data.listingText0) || "Results" },
      footer: { text: resultsPayload.footerText || "Done" },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_id: String(DEFAULT_FLOW_ID),
          flow_cta: resultsPayload.flow_cta || "View",
          flow_action: "navigate",
          flow_action_payload: { screen: resultsPayload.screen || "RESULTS", data: resultsPayload.data || {} },
        },
      },
    },
  };

  const phone = digitsOnly(phoneNumber);
  const hash = _hash(`flow_results:${JSON.stringify(interactivePayload.interactive)}`);
  if (!_shouldSend(phone, hash, TTL_INTERACTIVE_MS)) {
    console.log("[sendResultsFlow] suppressed duplicate results flow for", phone);
    return { suppressed: true };
  }

  return whatsappPost(phone_number_id, apiToken, interactivePayload);
}

/* -------------------------
   Dedupe of incoming messages (prevent re-processing)
------------------------- */
const SEEN_TTL_MS = 1000 * 60 * 5;
const seenMap = new Map();
function markSeenInMemory(id) { if (!id) return; seenMap.set(id, Date.now()); }
function isSeenInMemory(id) { if (!id) return false; const now = Date.now(); for (const [k, t] of seenMap) if (now - t > SEEN_TTL_MS) seenMap.delete(k); return seenMap.has(id); }
async function isAlreadyHandledMsg(dbAvailable, msgId) {
  if (!msgId) return false;
  if (dbAvailable && typeof Message?.findOne === "function") {
    try { const existing = await Message.findOne({ wa_message_id: msgId, "meta.handled": true }).lean().exec(); return Boolean(existing); } catch (e) { return false; }
  }
  return isSeenInMemory(msgId);
}
async function markHandledMsg(dbAvailable, msgId) {
  if (!msgId) return;
  if (dbAvailable && typeof Message?.findOneAndUpdate === "function") {
    try { await Message.findOneAndUpdate({ wa_message_id: msgId }, { $set: { "meta.handled": true } }, { upsert: true, setDefaultsOnInsert: true }).exec(); return; } catch (e) { markSeenInMemory(msgId); return; }
  }
  markSeenInMemory(msgId);
}

/* -------------------------
   Selection map (phone -> { ids, results })
------------------------- */
const selectionMap = new Map();

/* -------------------------
   ID normalizer
------------------------- */
function getIdFromListing(l) {
  if (!l) return "";
  if (typeof l._id === "string" && l._id) return l._id;
  if (l._id && typeof l._id === "object") {
    if (typeof l._id.toString === "function") {
      try { const s = l._id.toString(); if (s && s !== "[object Object]") return s; } catch (e) { }
    }
    if (l._id.$oid) return String(l._id.$oid);
  }
  if (l.id && typeof l.id === "string") return l.id;
  if (l._id && typeof l._id === "number") return String(l._id);
  return "";
}

function ensureListingHasId(listing, indexHint = 0) {
  if (!listing || typeof listing !== "object") return { listing: null, id: "" };
  const existingId = getIdFromListing(listing);
  if (existingId) return { listing, id: existingId };

  const title = typeof listing.title === "string" ? listing.title.trim() : "";
  const suburb = typeof listing.suburb === "string" ? listing.suburb.trim() : "";
  const price = listing.pricePerMonth ?? listing.price ?? "";
  const pseudoId = `seed_${_hash(`${title}|${suburb}|${price}|${indexHint}`).slice(0, 16)}`;

  const patched = { ...listing, _id: pseudoId };
  return { listing: patched, id: pseudoId };
}

function formatListingResultText(listing, indexHint = 0) {
  const { listing: ensured, id } = ensureListingHasId(listing, indexHint);
  if (!ensured) return "";

  const title = String(ensured.title || "Listing").trim();
  const suburb = String(ensured.suburb || "").trim();
  const price = ensured.pricePerMonth ?? ensured.price ?? "N/A";

  const description = ensured.description ? String(ensured.description).replace(/\s+/g, " ").trim() : "";
  const descriptionShort = description ? description.slice(0, 220) : "";

  const features = Array.isArray(ensured.features)
    ? ensured.features.map((f) => String(f || "").trim()).filter(Boolean)
    : [];

  const featuresShort = features.slice(0, 6);

  const lines = [`${indexHint + 1}) ${title} — ${suburb} — $${price} — ID:${id}`];

  if (descriptionShort) {
    lines.push("", "Description:", ` ${descriptionShort}`);
  }

  if (featuresShort.length) {
    lines.push("", "Features:", featuresShort.map((f) => ` * ${f}`).join("\n"));
  }

  return lines.join("\n");
}

/* -------------------------
   Flow detection & parsing helpers
------------------------- */
function detectRequestedScreen(rawPayload = {}) {
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
    _safeGet(v, ["messages", 0, "interactive", "flow", "screen"])
  ];
  for (const c of candidates) {
    if (!c) continue;
    if (typeof c === "string") { const s = c.trim(); if (s) return s.toUpperCase(); }
    if (typeof c === "object") {
      if (c.screen && typeof c.screen === "string") return c.screen.toUpperCase();
      const keys = Object.keys(c);
      if (keys.includes("city") || keys.includes("selected_city") || keys.includes("q") || keys.includes("min_price")) return "SEARCH";
    }
  }
  const flowData = getFlowDataFromPayload(rawPayload);
  if (flowData && (flowData.q || flowData.city || flowData.suburb || flowData.min_price || flowData.max_price)) return "SEARCH";
  return null;
}

function getFlowDataFromPayload(payload) {
  try {
    const v = payload?.entry?.[0]?.changes?.[0]?.value || payload || {};
    const nfmJson = _safeGet(v, ["messages", 0, "interactive", "nfm_reply", "response_json"]);
    if (nfmJson && typeof nfmJson === "string") {
      try { return JSON.parse(nfmJson); } catch (e) { /* ignore */ }
    }
    const msgInteractiveFlowData = _safeGet(v, ["messages", 0, "interactive", "flow", "data"]) || _safeGet(v, ["messages", 0, "interactive", "data"]) || _safeGet(v, ["messages", 0, "interactive"]);
    if (msgInteractiveFlowData && typeof msgInteractiveFlowData === "object") return msgInteractiveFlowData;
    const candidates = [_safeGet(v, ["data_exchange", "data"]), _safeGet(v, ["data_exchange"]), _safeGet(v, ["flow", "data"]), _safeGet(v, ["flow"]), _safeGet(v, ["data"]), payload?.data];
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
  } catch (e) { return {}; }
}

/* -------------------------
   Canonicalize incoming message
------------------------- */
function getCanonicalMessage(payload) {
  const msg = _safeGet(payload, ["entry", 0, "changes", 0, "value", "messages", 0]) || payload?.messages?.[0] || payload?.message || payload?.message_content || payload?.user_message || null;
  const id = (msg && (msg.id || msg._id || msg.message_id)) || payload?.message_id || payload?.wa_message_id || _safeGet(payload, ["entry", 0, "id"]) || null;
  const fromContact = _safeGet(payload, ["entry", 0, "changes", 0, "value", "contacts", 0, "wa_id"]);
  const from = (msg && (msg.from || msg.sender || msg.from_phone)) || fromContact || payload?.from || payload?.chat_id || payload?.phone_number || null;
  const text = (msg && ((msg.text && (msg.text.body || msg.text)) || msg.body || msg.body?.text || msg?.interactive?.button_reply?.id || msg?.interactive?.button_reply?.title || msg?.interactive?.list_reply?.id || msg?.interactive?.list_reply?.title)) || (typeof payload?.user_message === "string" ? payload.user_message : "") || "";
  return { msg, id: String(id || ""), from: String(from || ""), text: String(text || "") };
}

/* -------------------------
   Helper: send main menu (single composed instruction)
------------------------- */
async function sendMainMenu(phone) {
  const buttons = [
    { id: "menu_list", title: "List a property" },
    { id: "menu_search", title: "Search properties" },
    { id: "menu_contacts", title: "View past messages" },
    { id: "menu_report", title: "Report listing" },
  ];
  await sendInteractiveButtons(phone, "Welcome to CribMatch — choose an action:", buttons, { headerText: "Instructions: Tap an option" });
}

/* -------------------------
   POST: webhook handler
------------------------- */
export async function POST(request) {
  console.log("[webhook] POST invoked");

  // read raw body safely
  let rawBody = "";
  try { rawBody = await request.text(); } catch (e) { rawBody = ""; }
  let payload = {};
  if (rawBody) { try { payload = JSON.parse(rawBody); } catch (e) { payload = {}; } }

  // optional signature verification (non-fatal)
  try {
    const appSecret = process.env.APP_SECRET;
    const sigHeader = request.headers.get("x-hub-signature-256") || request.headers.get("X-Hub-Signature-256");
    if (appSecret && sigHeader) {
      const expectedSig = sigHeader.startsWith("sha256=") ? sigHeader.slice(7) : sigHeader;
      const hmac = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
      if (!crypto.timingSafeEqual(Buffer.from(expectedSig, "hex"), Buffer.from(hmac, "hex"))) {
        console.warn("[webhook] signature mismatch");
      }
    }
  } catch (e) { console.warn("[webhook] signature check error", e); }

  // DB connect best-effort
  let dbAvailable = true;
  try { await dbConnect(); } catch (e) { dbAvailable = false; console.error("[webhook] DB connect failed", e); }

  // persist raw event best-effort
  try {
    if (dbAvailable && typeof WebhookEvent?.create === "function") {
      const headersObj = Object.fromEntries(request.headers.entries());
      await WebhookEvent.create({ provider: "whatsapp", headers: headersObj, payload, receivedAt: new Date() }).catch(() => null);
    }
  } catch (e) { /* ignore */ }

  // canonicalize incoming
  const { msg, id: msgId, from: phoneRaw, text: parsedText } = getCanonicalMessage(payload);
  const phone = digitsOnly(phoneRaw || "");
  console.log("[webhook] incoming:", { msgId, phone, parsedText: parsedText.slice(0, 200) });

  if (!msgId && !phone) return NextResponse.json({ ok: true, note: "no-id-or-phone" });

  // dedupe incoming
  try {
    const already = await isAlreadyHandledMsg(dbAvailable, msgId);
    if (already) return NextResponse.json({ ok: true, note: "duplicate-event" });
    await markHandledMsg(dbAvailable, msgId);
  } catch (e) { console.warn("[webhook] dedupe error", e); }

  // persist incoming message as Message (best-effort)
  let savedMsg = null;
  try {
    if (dbAvailable && typeof Message?.create === "function") {
      const doc = {
        phone,
        from: msg?.from || "user",
        wa_message_id: msgId || null,
        type: parsedText ? "text" : "interactive",
        text: parsedText || "",
        raw: payload,
        meta: {},
      };
      try {
        savedMsg = await Message.create(doc);
      } catch (e) {
        try { savedMsg = await Message.findOneAndUpdate({ wa_message_id: msgId }, { $setOnInsert: doc }, { upsert: true, new: true }).exec(); } catch (e2) { savedMsg = null; }
      }
    }
  } catch (e) { console.warn("[webhook] save message error", e); }

  // get lastMeta (DB) or memory fallback
  let lastMeta = null;
  try {
    if (dbAvailable && typeof Message?.findOne === "function") {
      const doc = await Message.findOne({ phone, "meta.state": { $exists: true } }).sort({ createdAt: -1 }).lean().exec().catch(() => null);
      lastMeta = doc?.meta || null;
    }
  } catch (e) { console.warn("[webhook] lastMeta lookup error", e); lastMeta = null; }
  if (!lastMeta && selectionMap.has(phone)) {
    const mem = selectionMap.get(phone);
    lastMeta = { state: "AWAITING_LIST_SELECTION", listingIds: mem.ids || [], resultObjects: mem.results || [] };
  }

  // normalize user input
  const userRaw = String(parsedText || "").trim();
  const cmd = userRaw.toLowerCase();

  /* -------------------------
     Flow response handling (Search)
  ------------------------- */
  const flowData = getFlowDataFromPayload(payload);
  const screen = detectRequestedScreen(payload);

  if (screen === "SEARCH" || (flowData && (flowData.city || flowData.q || flowData.min_price || flowData.max_price))) {
    console.log("[webhook] flow search submission:", flowData);

    let results = { listings: [], total: 0 };
    try {
      results = await searchPublishedListings({
        q: flowData.q || "",
        city: flowData.city || "",
        suburb: flowData.suburb || "",
        minPrice: flowData.min_price || null,
        maxPrice: flowData.max_price || null,
        propertyCategory: flowData.property_category || "",
        propertyType: flowData.property_type || "",
        minBeds: flowData.bedrooms || null,
        perPage: 6
      });
    } catch (e) {
      console.warn("[webhook] flow search error", e);
    }

    const items = (results.listings || []).slice(0, 6);
    if (!items.length) {
      await sendWithMainMenuButton(phone, "No matches found for your search.", "Try adjusting filters or a broader search.");
      return NextResponse.json({ ok: true, note: "flow-search-no-results" });
    }

    const ensured = items.map((item, i) => ensureListingHasId(item, i));
    const ensuredItems = ensured.map((e) => e.listing).filter(Boolean);
    const ids = ensured.map((e) => e.id).filter(Boolean);
    const numbered = ensuredItems.map((l, i) => formatListingResultText(l, i)).filter(Boolean).join("\n\n");

    await saveSearchContext(phone, ids, ensuredItems, dbAvailable);
    let msgText = `Reply with the number (e.g. 1) to get contact details.\n\n${numbered}`.trim();
    if (msgText.length > 3900) msgText = `${msgText.slice(0, 3880).trim()}\n…`;
    await sendText(phone, msgText);

    selectionMap.set(phone, { ids, results: ensuredItems });
    if (dbAvailable && savedMsg && savedMsg._id) {
      await Message.findByIdAndUpdate(savedMsg._id, {
        $set: {
          "meta.state": "AWAITING_LIST_SELECTION",
          "meta.listingIds": ids,
          "meta.resultObjects": ensuredItems,
          "meta.flowData": flowData
        }
      }).catch(() => null);
    }

    return NextResponse.json({ ok: true, note: "flow-search-results-sent" });
  }

  /* -------------------------
     PRIORITY: Global commands
  ------------------------- */

  // menu
  if (/^menu$|^menu_main$|^main menu$/i.test(userRaw)) {
    await sendMainMenu(phone);
    return NextResponse.json({ ok: true, note: "menu-sent" });
  }

  // list a property
  if (cmd === "list" || cmd === "list a property" || cmd === "menu_list") {
    if (dbAvailable && savedMsg && savedMsg._id) {
      await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.state": "LISTING_WAIT_TITLE", "meta.listingDraft": {} } }).catch(() => null);
    }
    await sendWithMainMenuButton(phone, "Let's list your property.\n\nStep 1 of 4: What's the property title? (e.g. 2-bed garden flat, Glen Norah)", "Reply with the title.");
    return NextResponse.json({ ok: true, note: "listing-started" });
  }

  if (cmd === "msg_search") {
    await sendWithMainMenuButton(phone, "Search by message.\n\nSend: Area, optional budget\n\nExample:\nBorrowdale, $200", "Reply with the area and optional budget.");
    return NextResponse.json({ ok: true, note: "msg-search" });
  }

  if (cmd === "open_search") {
    const flowResp = await sendSearchFlow(phone, { headerText: "Instructions: Tap Continue", bodyText: "Only City is required. Other filters are optional.", footerText: "Search", screen: "SEARCH", cities: PREDEFINED_CITIES }).catch((e) => ({ error: e }));
    if (flowResp?.error || flowResp?.suppressed) {
      await sendWithMainMenuButton(phone, "Couldn't open the search form right now.", "Reply with area and optional budget, or tap Main menu.");
    } else {
      await sendWithMainMenuButton(phone, "Search form opened.", "Fill and submit the form, or reply with area and optional budget.");
    }
    return NextResponse.json({ ok: true, note: "open-search", flowResp });
  }

  if (cmd === "help") {
    await sendWithMainMenuButton(
      phone,
      "Help\n\n- Tap buttons to choose options.\n- When you see a list, reply with the number (e.g. 1).\n- You can type menu anytime.",
      "Read the steps above, then tap Main menu."
    );
    return NextResponse.json({ ok: true, note: "help" });
  }

  // SEARCH command (robust)
  if (cmd === "search" || cmd === "search properties" || cmd === "menu_search") {
    console.log("[webhook] search command invoked for", phone);
    const flowResp = await sendSearchFlow(phone, { headerText: "Instructions: Tap Continue", bodyText: "Only City is required. Other filters are optional.", footerText: "Search", screen: "SEARCH", cities: PREDEFINED_CITIES }).catch((e) => { console.warn("[webhook] sendSearchFlow threw:", e); return { error: e }; });
    console.log("[webhook] sendSearchFlow result:", flowResp);

    if (flowResp?.error || flowResp?.suppressed) {
      console.log("[webhook] sending fallback interactive/buttons for search");
      await sendInteractiveButtons(phone, "Search options — choose one:", [
        { id: "msg_search", title: "Search by message" },
        { id: "open_search", title: "Open search form" },
        { id: "help", title: "Help" },
      ], { headerText: "Instructions: Tap an option" }).catch((e) => console.warn("[webhook] sendInteractiveButtons error:", e));

      await sendWithMainMenuButton(phone, "You can fill the form, or send a message like:\n\nBorrowdale, $200", "Reply with area and optional budget.").catch((e) => console.warn("[webhook] sendText fallback error:", e));
    } else {
      await sendWithMainMenuButton(phone, "Search form opened.\n\nIf you prefer, you can also send a message like:\n\nBorrowdale, $200", "Fill and submit the form, or reply with area and optional budget.").catch((err) => console.warn("[webhook] sendText after flow error:", err));
    }

    if (dbAvailable && savedMsg && savedMsg._id) {
      await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.sentSearchFlow": true, "meta.sendResp": flowResp } }).catch(() => null);
    }
    return NextResponse.json({ ok: true, note: "search-invoked", flowResp });
  }

  // view past messages / contacts
  if (cmd === "view past messages" || cmd === "view past" || cmd === "menu_contacts" || cmd === "view past messages") {
    let listingIds = [];
    if (dbAvailable && typeof Message?.find === "function") {
      const docs = await Message.find({ phone, "meta.listingIdSelected": { $exists: true } }).lean().exec().catch(() => []);
      listingIds = Array.from(new Set(docs.map((d) => d?.meta?.listingIdSelected).filter(Boolean)));
    }
    if ((!listingIds || listingIds.length === 0) && selectionMap.has(phone)) {
      const mem = selectionMap.get(phone);
      if (mem && Array.isArray(mem.ids)) listingIds = Array.from(new Set(mem.ids.filter(Boolean)));
    }
    if (!listingIds || listingIds.length === 0) {
      await sendWithMainMenuButton(phone, "You haven't requested any contacts yet.", "From the main menu, tap Search properties.");
      return NextResponse.json({ ok: true, note: "no-past-messages" });
    }
    let found = [];
    if (dbAvailable && typeof Listing?.find === "function") {
      try { found = await Listing.find({ _id: { $in: listingIds } }).lean().exec().catch(() => []); } catch (e) { found = []; }
    }
    const summaries = listingIds.map((id) => {
      const f = found.find((x) => String(x._id) === String(id));
      if (f) return { id, title: f.title || "Listing", suburb: f.suburb || "", price: f.pricePerMonth || f.price || 0 };
      const mem = selectionMap.get(phone);
      const r = mem?.results?.find((rr) => getIdFromListing(rr) === id) || null;
      if (r) return { id, title: r.title || "Listing", suburb: r.suburb || "", price: r.pricePerMonth || r.price || 0 };
      return { id, title: `Listing ${id.slice(0, 8)}`, suburb: "", price: 0 };
    });
    const text = ["Your recent contacts:"].concat(summaries.map((s, i) => `${i + 1}) ${s.title} — ${s.suburb} — $${s.price} — ID:${s.id}`)).join("\n\n");
    await sendTextWithInstructionHeader(phone, text, "Reply with the number (e.g. 1) to view contact details again.");
    await sendButtonsWithInstructionHeader(phone, "Return to main menu:", [{ id: "menu_main", title: "Main menu" }], "Tap Main menu.");
    selectionMap.set(phone, { ids: listingIds, results: summaries.map(s => ({ _id: s.id, title: s.title, suburb: s.suburb, price: s.price })) });
    return NextResponse.json({ ok: true, note: "past-messages-sent" });
  }

  // report listing
  if (cmd === "report listing" || cmd === "menu_report" || cmd === "report") {
    if (dbAvailable && savedMsg && savedMsg._id) await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.state": "REPORT_WAIT_ID" } }).catch(() => null);
    await sendWithMainMenuButton(phone, "Report a listing.\n\nStep 1 of 2: What is the listing ID? (e.g. 60df12ab...)", "Reply with the listing ID.");
    return NextResponse.json({ ok: true, note: "report-started" });
  }

  /* -------------------------
     Listing creation flow
  ------------------------- */
  if (lastMeta && lastMeta.state && String(lastMeta.state).startsWith("LISTING_")) {
    const state = lastMeta.state;
    if (state === "LISTING_WAIT_TITLE") {
      const title = userRaw;
      if (!title) { await sendWithMainMenuButton(phone, "Title missing.", "Reply with the property title."); return NextResponse.json({ ok: true }); }
      if (dbAvailable && savedMsg && savedMsg._id) {
        await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.listingDraft.title": title, "meta.state": "LISTING_WAIT_SUBURB" } }).catch(() => null);
      }
      await sendWithMainMenuButton(phone, "Step 2 of 4: What suburb is the property in? (optional)", "Reply with the suburb, or type SKIP.");
      return NextResponse.json({ ok: true });
    }
    if (state === "LISTING_WAIT_SUBURB") {
      const suburb = userRaw;
      if (!suburb) { await sendWithMainMenuButton(phone, "Suburb missing.", "Reply with the suburb, or type SKIP."); return NextResponse.json({ ok: true }); }
      if (dbAvailable && savedMsg && savedMsg._id) {
        const storedSuburb = /^skip$/i.test(suburb) ? "" : suburb;
        await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.listingDraft.suburb": storedSuburb, "meta.state": "LISTING_WAIT_PRICE" } }).catch(() => null);
      }
      await sendWithMainMenuButton(phone, "Step 3 of 4: What is the monthly price? (numbers only, e.g. 500)", "Reply with the monthly price.");
      return NextResponse.json({ ok: true });
    }
    if (state === "LISTING_WAIT_PRICE") {
      const priceMatch = userRaw.match(/(\d+(?:\.\d+)?)/);
      if (!priceMatch) { await sendWithMainMenuButton(phone, "Price missing.", "Reply with a numeric price (e.g. 500)."); return NextResponse.json({ ok: true }); }
      const price = Number(priceMatch[1]);
      if (dbAvailable && savedMsg && savedMsg._id) {
        await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.listingDraft.price": price, "meta.state": "LISTING_CONFIRM" } }).catch(() => null);
      }
      const draftDoc = (dbAvailable && savedMsg && savedMsg._id) ? (await Message.findById(savedMsg._id).lean().exec().catch(() => null)) : null;
      const draft = draftDoc?.meta?.listingDraft || {};
      const confirmText = `Please confirm your listing:\n\nTitle: ${draft.title || "<unknown>"}\nSuburb: ${draft.suburb || "<optional>"}\nPrice: $${draft.price || price}\n\nTap YES to publish or NO to cancel.`;
      await sendButtonsWithInstructionHeader(phone, confirmText, [
        { id: "confirm_yes", title: "YES" },
        { id: "confirm_no", title: "NO" },
        { id: "menu_main", title: "Main menu" },
      ], "Tap YES to publish, NO to cancel.");
      return NextResponse.json({ ok: true });
    }
    if (state === "LISTING_CONFIRM") {
      if (/^yes$/i.test(userRaw) || userRaw === "confirm_yes") {
        if (dbAvailable && savedMsg && savedMsg._id) {
          const doc = await Message.findById(savedMsg._id).lean().exec().catch(() => null);
          const draft = doc?.meta?.listingDraft || {};
          try {
            const created = await Listing.create({
              title: draft.title || "Untitled",
              listerPhoneNumber: phone,
              suburb: draft.suburb || "",
              propertyCategory: "residential",
              propertyType: "house",
              pricePerMonth: draft.price || 0,
              bedrooms: 1,
              status: "published",
            });
            await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.state": "LISTING_PUBLISHED", "meta.listingPublishedId": String(created._id) } }).catch(() => null);
            await sendInteractiveButtons(phone, `ID: ${String(created._id)}`, [{ id: "menu_main", title: "Main menu" }], { headerText: "Listing created ✅" });
            return NextResponse.json({ ok: true, note: "listing-created" });
          } catch (e) {
            console.warn("[listing] create failed", e);
            await sendWithMainMenuButton(phone, "Couldn't create the listing right now.", "Tap Main menu, then try again later.");
            return NextResponse.json({ ok: true, note: "listing-create-failed" });
          }
        } else {
          await sendWithMainMenuButton(phone, "No listing draft found.", "Tap Main menu, then choose List a property.");
          return NextResponse.json({ ok: true });
        }
      } else {
        if (dbAvailable && savedMsg && savedMsg._id) await Message.findByIdAndUpdate(savedMsg._id, { $unset: { "meta.listingDraft": "", "meta.state": "" } }).catch(() => null);
        await sendWithMainMenuButton(phone, "Listing cancelled.", "Tap Main menu.");
        return NextResponse.json({ ok: true, note: "listing-cancelled" });
      }
    }
  }

  /* -------------------------
     Report flow
  ------------------------- */
  if (lastMeta && lastMeta.state && lastMeta.state === "REPORT_WAIT_ID") {
    const listingId = userRaw;
    if (!listingId) { await sendWithMainMenuButton(phone, "Listing ID missing.", "Reply with the listing ID."); return NextResponse.json({ ok: true }); }
    if (dbAvailable && savedMsg && savedMsg._id) await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.report.listingId": listingId, "meta.state": "REPORT_WAIT_REASON" } }).catch(() => null);
    await sendWithMainMenuButton(phone, `Reporting ${listingId}.\n\nStep 2 of 2: What is the reason? (e.g. spam, duplicate, wrong price)`, "Reply with the reason.");
    return NextResponse.json({ ok: true, note: "report-step2" });
  }
  if (lastMeta && lastMeta.state && lastMeta.state === "REPORT_WAIT_REASON") {
    const reason = userRaw || "unspecified";
    const listingId = lastMeta.report?.listingId || (dbAvailable && savedMsg && savedMsg._id ? (await Message.findById(savedMsg._id).lean().exec().catch(() => null))?.meta?.report?.listingId : null);
    if (dbAvailable && savedMsg && savedMsg._id) {
      await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.report.reason": reason, "meta.report.submittedAt": new Date(), "meta.state": "REPORT_SUBMITTED" } }).catch(() => null);
    }
    await sendWithMainMenuButton(phone, `Thanks — your report for listing ${listingId || ""} has been received. Our team will review it.`, "Tap Main menu.");
    return NextResponse.json({ ok: true, note: "report-submitted" });
  }

  /* -------------------------
     images <id>
  ------------------------- */
  if (/^images?\b/i.test(userRaw) || /^view_images_/.test(userRaw)) {
    const m = userRaw.match(/^images?\s+(.+)$/i);
    const listingId = /^view_images_/.test(userRaw) ? userRaw.slice("view_images_".length).trim() : (m ? m[1].trim() : null);
    if (!listingId) {
      await sendWithMainMenuButton(phone, "Image request missing listing ID.", "Reply like: images <listing-id>.");
      return NextResponse.json({ ok: true, note: "images-missing-id" });
    }
    const imgHash = _hash(`images:${listingId}`);
    if (!_shouldSend(phone, imgHash, TTL_INTERACTIVE_MS)) return NextResponse.json({ ok: true, note: "images-suppressed" });

    let listing = null;
    try { listing = await getListingById(listingId).catch(() => null); } catch (e) { listing = null; }
    if (!listing && typeof Listing?.findById === "function") listing = await Listing.findById(listingId).lean().exec().catch(() => null);
    const imgs = (listing && (listing.images || listing.photos || listing.photosUrls || [])) || [];
    if (!imgs || imgs.length === 0) {
      await sendWithMainMenuButton(phone, "No images found for this listing.", "Tap Main menu.");
      return NextResponse.json({ ok: true, note: "images-not-found" });
    }
    const title = listing?.title ? String(listing.title) : "Listing";
    const shown = imgs.slice(0, 8);
    const more = Math.max(0, imgs.length - shown.length);
    const lines = [`Images for ${title}:`].concat(shown.map((u, i) => `${i + 1}) ${u}`));
    if (more) lines.push(`+${more} more`);
    lines.push("", "Main menu: menu");
    await sendTextWithInstructionHeader(phone, lines.join("\n"), "Open an image link to view.");
    return NextResponse.json({ ok: true, note: "images-sent" });
  }

  /* -------------------------
     Selection-by-number
  ------------------------- */
  if (/^[1-9]\d*$/.test(userRaw) || /^select_/.test(userRaw) || /^contact\s+/i.test(userRaw)) {
    console.log("[webhook] selection attempt:", { phone, userRaw, hasLastMeta: !!lastMeta, memSize: selectionMap.size });

    let listingId = null;
    let listingFromResults = null;
    const mem = selectionMap.get(phone);

    let lastIds = (lastMeta && Array.isArray(lastMeta.listingIds) && lastMeta.listingIds.length > 0)
      ? lastMeta.listingIds
      : (mem?.ids || []);

    let lastResults = (lastMeta && Array.isArray(lastMeta.resultObjects) && lastMeta.resultObjects.length > 0)
      ? lastMeta.resultObjects
      : (mem?.results || []);

    if (dbAvailable && typeof Message?.findOne === "function") {
      const doc = await Message.findOne({
        phone,
        $or: [
          { "meta.kind": "SEARCH_RESULTS" },
          { "meta.listingIds.0": { $exists: true } },
          { "meta.resultObjects.0": { $exists: true } },
          { "meta.state": "AWAITING_LIST_SELECTION" },
        ],
      })
        .sort({ createdAt: -1 })
        .lean()
        .exec()
        .catch(() => null);

      const meta = doc?.meta || null;
      if (meta && Array.isArray(meta.listingIds) && meta.listingIds.length) lastIds = meta.listingIds;
      if (meta && Array.isArray(meta.resultObjects) && meta.resultObjects.length) lastResults = meta.resultObjects;
    }

    console.log("[webhook] selection candidates:", { idsLen: lastIds.length, resultsLen: lastResults.length });

    if (/^select_/.test(userRaw)) {
      listingId = userRaw.slice("select_".length).trim();
    } else if (/^contact\s+/i.test(userRaw)) {
      const m = userRaw.match(/^contact\s+(.+)$/i);
      listingId = m ? m[1].trim() : null;
      if (listingId && listingId.startsWith("seed_") && Array.isArray(lastResults) && lastResults.length) {
        listingFromResults = lastResults.find((r) => getIdFromListing(r) === listingId) || null;
      }
    } else {
      const idx = parseInt(userRaw, 10) - 1;
      if (idx >= 0) {
        if (idx < lastResults.length) {
          const r = lastResults[idx];
          const ensured = ensureListingHasId(r, idx);
          listingFromResults = ensured.listing;
          listingId = ensured.id;
        } else if (idx < lastIds.length) {
          listingId = lastIds[idx];
        }
      }
    }

    console.log("[webhook] selection resolved:", { listingId });

    if (!listingId) {
      await sendWithMainMenuButton(phone, "Couldn't determine the listing from your reply.", "Tap a listing from the results, or reply: contact <ID> (shown in the list).");
      return NextResponse.json({ ok: true, note: "selection-unknown" });
    }

    // try to fetch listing (helper + DB)
    let listing = listingFromResults;
    if (!listing && !String(listingId || "").startsWith("seed_")) {
      try { listing = await getListingById(listingId).catch(() => null); } catch (e) { listing = null; }
    }
    if (!listing && dbAvailable && typeof Listing?.findById === "function") listing = await Listing.findById(listingId).lean().exec().catch(() => null);
    if (!listing && Array.isArray(lastResults)) listing = lastResults.find((r) => getIdFromListing(r) === listingId || String(r._id) === listingId) || null;
    if (!listing) {
      await sendWithMainMenuButton(phone, "Sorry, listing not found.", "Reply again with the number shown (e.g. 1), or tap Main menu.");
      return NextResponse.json({ ok: true, note: "listing-not-found" });
    }

    // reveal contact
    await revealFromObject(listing, phone);

    // save that user viewed this contact
    if (dbAvailable && savedMsg && savedMsg._id) {
      await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.listingIdSelected": getIdFromListing(listing) } }).catch(() => null);
    }

    // update selectionMap
    try {
      const mem = selectionMap.get(phone) || { ids: [], results: [] };
      const lid = getIdFromListing(listing);
      if (!mem.ids.includes(lid)) mem.ids.unshift(lid);
      if (!mem.results.find((r) => getIdFromListing(r) === lid)) mem.results.unshift({ _id: lid, title: listing.title || "Listing", suburb: listing.suburb || "", price: listing.pricePerMonth || listing.price || 0 });
      mem.ids = mem.ids.slice(0, 20);
      mem.results = mem.results.slice(0, 20);
      selectionMap.set(phone, mem);
    } catch (e) { /* ignore */ }

    return NextResponse.json({ ok: true, note: "contact-sent" });
  }

  /* -------------------------
     Simple search fallback (area, $budget)
  ------------------------- */
  if (userRaw && !lastMeta) {
    const budgetMatch = userRaw.match(/\$?(\d+(?:\.\d+)?)/);
    const area = userRaw.split(",")[0].trim();
    if (area || budgetMatch) {
      const budget = budgetMatch ? Number(budgetMatch[1]) : null;
      let results = { listings: [], total: 0 };
      try { results = await searchPublishedListings({ q: area, minPrice: null, maxPrice: budget, perPage: 6 }); } catch (e) { console.warn("[webhook] searchPublishedListings error", e); results = { listings: [], total: 0 }; }
      const items = (results.listings || []).slice(0, 6);
      if (!items.length) {
        await sendWithMainMenuButton(phone, "No matches found.", "Try a broader area or higher budget, or tap Main menu.");
        return NextResponse.json({ ok: true, note: "search-no-results" });
      }
      const ensured = items.map((item, i) => ensureListingHasId(item, i));
      const ensuredItems = ensured.map((e) => e.listing).filter(Boolean);
      const ids = ensured.map((e) => e.id).filter(Boolean);
      const numbered = ensuredItems.map((l, i) => formatListingResultText(l, i)).filter(Boolean).join("\n\n");
      await saveSearchContext(phone, ids, ensuredItems, dbAvailable);
      await sendTextWithInstructionHeader(phone, numbered, "Reply with the number (e.g. 1) to view contact details.");
      await sendButtonsWithInstructionHeader(phone, "Return to main menu:", [{ id: "menu_main", title: "Main menu" }], "Tap Main menu.");
      selectionMap.set(phone, { ids, results: ensuredItems });
      if (dbAvailable && savedMsg && savedMsg._id) {
        await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.state": "AWAITING_LIST_SELECTION", "meta.listingIds": ids, "meta.resultObjects": ensuredItems } }).catch(() => null);
      }
      return NextResponse.json({ ok: true, note: "search-results-sent" });
    }
  }

  // default fallback
  await sendMainMenu(phone);
  return NextResponse.json({ ok: true, note: "default-menu" });
}

/* -------------------------
   GET: webhook verification (Meta handshake)
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
    process.env.META_WEBHOOK_VERIFY_TOKEN ||
    process.env.WEBHOOK_VERIFY_TOKEN ||
    "";

  if (!expectedToken) return new Response("Missing verify token", { status: 500 });
  if (mode === "subscribe" && token && challenge && token === expectedToken) return new Response(challenge, { status: 200 });
  return new Response("Forbidden", { status: 403 });
}

/* -------------------------
   Helpers for reveal/save/post-selection buttons
------------------------- */
async function tryRevealByIdOrCached(listingId, phone, idsFromMeta = [], resultsFromMeta = [], dbAvailable = true) {
  try {
    if (!listingId) return false;

    // 1) helper getListingById
    try {
      const listing = await getListingById(listingId).catch(() => null);
      if (listing) { await revealFromObject(listing, phone); await saveUserSelectedListing(phone, listingId, dbAvailable); return true; }
    } catch (e) { console.warn("[tryReveal] getListingById failed:", e); }

    // 2) Listing.findById
    try {
      if (typeof Listing?.findById === "function") {
        const dbListing = await Listing.findById(listingId).lean().exec().catch(() => null);
        if (dbListing) { await revealFromObject(dbListing, phone); await saveUserSelectedListing(phone, listingId, dbAvailable); return true; }
      }
    } catch (e) { console.warn("[tryReveal] Listing.findById failed:", e); }

    // 3) fallback to resultsFromMeta mapping
    if (Array.isArray(idsFromMeta) && idsFromMeta.length > 0 && Array.isArray(resultsFromMeta)) {
      const idx = idsFromMeta.indexOf(listingId);
      if (idx >= 0 && resultsFromMeta[idx]) { await revealFromObject(resultsFromMeta[idx], phone); await saveUserSelectedListing(phone, listingId, dbAvailable); return true; }
    }

    // 4) defensive substring match
    if (Array.isArray(resultsFromMeta) && resultsFromMeta.length) {
      for (const r of resultsFromMeta) {
        const candidateId = getIdFromListing(r);
        if (candidateId && listingId && candidateId.includes(listingId)) { await revealFromObject(r, phone); await saveUserSelectedListing(phone, candidateId, dbAvailable); return true; }
      }
    }

    await sendWithMainMenuButton(phone, "Sorry, listing not found.", "If you still see results, reply again with the number shown (e.g. 1), or tap Main menu.");
    return false;
  } catch (e) {
    console.error("[tryRevealByIdOrCached] unexpected error:", e);
    try { await sendWithMainMenuButton(phone, "Sorry — couldn't fetch contact details right now.", "Tap Main menu."); } catch { }
    return false;
  }
}

async function sendPostSelectionButtons(listing, phone) {
  try {
    const theId = getIdFromListing(listing) || String(listing._id || "");
    await sendInteractiveButtons(phone, "What next?", [
      { id: "menu_main", title: "Main menu" },
      { id: "menu_contacts", title: "View my contacts" },
      { id: `view_images_${theId}`, title: "View images" },
    ], { headerText: "Instructions: Tap an option" });
  } catch (e) { console.warn("[sendPostSelectionButtons] error:", e); }
}

async function saveUserSelectedListing(phone, listingId, dbAvailable) {
  try {
    if (!dbAvailable) return;
    if (typeof Message?.findOneAndUpdate === "function") {
      await Message.findOneAndUpdate({ phone: digitsOnly(phone) }, { $set: { "meta.listingIdSelected": listingId, "meta.state": "CONTACT_REVEALED" } }, { sort: { createdAt: -1 }, upsert: false }).exec().catch(() => null);
    }
  } catch (e) { /* ignore */ }
}

async function revealFromObject(listing, phone) {
  try {
    if (!listing) { await sendWithMainMenuButton(phone, "Sorry, listing not found.", "Tap Main menu."); return; }

    const { listing: ensuredListing, id: ensuredId } = ensureListingHasId(listing, 0);
    if (!ensuredListing) { await sendWithMainMenuButton(phone, "Sorry, listing not found.", "Tap Main menu."); return; }

    listing = ensuredListing;
    const title = listing.title || listing.name || "Listing";
    const suburb = listing.suburb || listing.location?.suburb || "";
    const price = listing.pricePerMonth != null ? `$${listing.pricePerMonth}` : (listing.price != null ? `$${listing.price}` : "N/A");
    const bedrooms = listing.bedrooms != null ? `${listing.bedrooms} bed(s)` : "";
    const description = listing.description ? String(listing.description).slice(0, 700) : "";
    const features = Array.isArray(listing.features) ? listing.features.filter(Boolean) : [];
    const images = Array.isArray(listing.images) ? listing.images.filter(Boolean) : [];

    const contactName = listing.contactName || listing.ownerName || "Owner";
    const contactPhone = listing.contactPhone || listing.listerPhoneNumber || listing.contactWhatsApp || "N/A";
    const contactWhatsApp = listing.contactWhatsApp || "";
    const contactEmail = listing.contactEmail || listing.email || "";

    const detailsLines = [
      `Contact for: ${title}`,
      ensuredId ? `Listing ID: ${ensuredId}` : null,
      suburb ? `Suburb: ${suburb}` : null,
      bedrooms ? `Bedrooms: ${bedrooms}` : null,
      `Price: ${price}`,
      "",
      `Contact: ${contactName}`,
      `Phone: ${contactPhone}`,
      contactWhatsApp ? `WhatsApp: ${contactWhatsApp}` : null,
      contactEmail ? `Email: ${contactEmail}` : null,
    ].filter(Boolean);

    const blocks = [detailsLines.join("\n")];

    if (description) {
      blocks.push(`Description:\n${description}`);
    }

    if (features && features.length) {
      blocks.push(`Features:\n• ${features.slice(0, 12).join("\n• ")}`);
    }

    if (images.length) {
      const shown = images.slice(0, 6);
      const more = Math.max(0, images.length - shown.length);
      const photoLines = shown.map((u, i) => `${i + 1}) ${u}`);
      if (more) photoLines.push(`+${more} more`);
      blocks.push(`Photos:\n${photoLines.join("\n")}`);
    }

    blocks.push(`\nNext:\n- Reply with a number from your last results anytime\n- To see photos again: images ${ensuredId}\n- Main menu: menu`);

    let body = blocks.join("\n\n").trim();
    if (body.length > 3600) body = `${body.slice(0, 3580).trim()}\n…`;
    await sendTextWithInstructionHeader(phone, body, "Use the details below to contact the lister.");
  } catch (e) {
    console.error("[revealFromObject] error:", e);
    try { await sendWithMainMenuButton(phone, "Sorry — couldn't fetch contact details right now.", "Tap Main menu."); } catch { }
  }
}
