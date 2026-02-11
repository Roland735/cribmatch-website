// app/api/webhooks/whatsapp/route.js
//
// Updated: reliably send SEARCH flow when user says "search" (or variants).
// Avoid duplicate interactive/text sends which caused garbled UI.
// Keeps: selection-by-number, View My Contacts, View Images, Main Menu.
// Required env:
//  - WHATSAPP_API_TOKEN
//  - WHATSAPP_PHONE_NUMBER_ID (or WHATSAPP_PHONE_ID)
//  - WHATSAPP_FLOW_ID
//  - WHATSAPP_WEBHOOK_VERIFY_TOKEN
//  - APP_SECRET (optional)
//
import { NextResponse } from "next/server";
import crypto from "crypto";
import { dbConnect, WebhookEvent, Listing } from "@/lib/db";
import Message from "@/lib/Message";
import { getListingById, searchPublishedListings } from "@/lib/getListings";

export const runtime = "nodejs";

/* -------------------------
   Small utils
------------------------- */
function digitsOnly(v) {
  return String(v || "").replace(/\D/g, "");
}
function _safeGet(obj, path) {
  try { return path.reduce((o, k) => (o && o[k] != null ? o[k] : undefined), obj); } catch (e) { return undefined; }
}

/* -------------------------
   WhatsApp helpers (graph)
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
  if (!apiToken || !phone_number_id) {
    console.log("[sendText] missing creds — message preview:", message.slice(0, 300));
    return { error: "missing-credentials" };
  }
  const payload = { messaging_product: "whatsapp", to: digitsOnly(phoneNumber), type: "text", text: { body: message } };
  return whatsappPost(phone_number_id, apiToken, payload);
}

async function sendInteractiveButtons(phoneNumber, bodyText, buttons = []) {
  const apiToken = process.env.WHATSAPP_API_TOKEN;
  const phone_number_id = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;
  const fallback = [bodyText, "", ...buttons.map((b, i) => `${i + 1}) ${b.title}`), "", "Reply with the number (e.g. 1) or the command."].join("\n");
  if (!apiToken || !phone_number_id) {
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
      action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })) },
    },
  };
  const res = await whatsappPost(phone_number_id, apiToken, interactivePayload);
  if (res?.error) {
    await sendText(phoneNumber, fallback);
  }
  return res;
}

/* -------------------------
   Flow helpers
------------------------- */
const DEFAULT_FLOW_ID = process.env.WHATSAPP_FLOW_ID || "1534021024566343";
const PREDEFINED_CITIES = [
  { id: "harare", title: "Harare" },
  { id: "bulawayo", title: "Bulawayo" },
  { id: "mutare", title: "Mutare" },
];

async function sendSearchFlow(phoneNumber, flowId = DEFAULT_FLOW_ID, data = {}) {
  const apiToken = process.env.WHATSAPP_API_TOKEN;
  const phone_number_id = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;
  if (!apiToken || !phone_number_id) return { error: "missing-credentials" };

  const payloadData = {
    cities: (data.cities || PREDEFINED_CITIES).map((c) => ({ id: c.id, title: c.title })),
    suburbs: data.suburbs || [],
    propertyCategories: data.propertyCategories || [{ id: "residential", title: "Residential" }, { id: "commercial", title: "Commercial" }],
    propertyTypes: data.propertyTypes || [{ id: "house", title: "House" }, { id: "flat", title: "Flat" }, { id: "studio", title: "Studio" }],
    bedrooms: data.bedrooms || [{ id: "any", title: "Any" }, { id: "1", title: "1" }, { id: "2", title: "2" }, { id: "3", title: "3" }],
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
          flow_action_payload: { screen: data.screen || "SEARCH", data: payloadData },
        },
      },
    },
  };

  return whatsappPost(phone_number_id, apiToken, interactivePayload);
}

async function sendResultsFlow(phoneNumber, flowId = DEFAULT_FLOW_ID, resultsPayload = {}) {
  const apiToken = process.env.WHATSAPP_API_TOKEN;
  const phone_number_id = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;
  if (!apiToken || !phone_number_id) return { error: "missing-credentials" };

  const interactivePayload = {
    messaging_product: "whatsapp",
    to: digitsOnly(phoneNumber),
    type: "interactive",
    interactive: {
      type: "flow",
      header: { type: "text", text: resultsPayload.headerText || "Search results" },
      body: { text: resultsPayload.bodyText || (resultsPayload.data && resultsPayload.data.listingText0) || "Results" },
      footer: { text: resultsPayload.footerText || "Done" },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_id: String(flowId),
          flow_cta: resultsPayload.flow_cta || "View",
          flow_action: "navigate",
          flow_action_payload: { screen: resultsPayload.screen || "RESULTS", data: resultsPayload.data || {} },
        },
      },
    },
  };

  return whatsappPost(phone_number_id, apiToken, interactivePayload);
}

/* -------------------------
   Main menu helper
------------------------- */
async function sendMainMenu(phone) {
  const buttons = [
    { id: "menu_list", title: "List a property" },
    { id: "menu_search", title: "Search properties" },
    { id: "menu_purchases", title: "View my purchases" },
  ];
  await sendInteractiveButtons(phone, "Main menu — choose an option:", buttons);
  await sendText(phone, "Or reply with the number (e.g. 1) or the command (e.g. 'search').");
}

/* -------------------------
   Dedupe + memory fallback
------------------------- */
const SEEN_TTL_MS = 1000 * 60 * 5;
const seenMap = new Map();
function markSeenInMemory(id) { if (!id) return; seenMap.set(id, Date.now()); }
function isSeenInMemory(id) { if (!id) return false; const now = Date.now(); for (const [k, t] of seenMap) if (now - t > SEEN_TTL_MS) seenMap.delete(k); return seenMap.has(id); }
async function isAlreadyHandledMsg(dbAvailable, msgId) {
  if (!msgId) return false;
  if (dbAvailable && typeof Message?.findOne === "function") {
    try { const existing = await Message.findOne({ wa_message_id: msgId, "meta.handledHiFlow": true }).lean().exec(); return Boolean(existing); } catch (e) { return false; }
  }
  return isSeenInMemory(msgId);
}
async function markHandledMsg(dbAvailable, msgId) {
  if (!msgId) return;
  if (dbAvailable && typeof Message?.findOneAndUpdate === "function") {
    try { await Message.findOneAndUpdate({ wa_message_id: msgId }, { $set: { "meta.handledHiFlow": true } }, { upsert: true, setDefaultsOnInsert: true }).exec(); return; } catch (e) { markSeenInMemory(msgId); return; }
  }
  markSeenInMemory(msgId);
}

/* -------------------------
   In-memory selection map: phone -> { ids:[], results:[] }
------------------------- */
const selectionMap = new Map();

/* -------------------------
   Listing id normalizer
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

/* -------------------------
   Flow detection / parsing
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
    _safeGet(v, ["action"]),
    _safeGet(v, ["data"]),
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
    const v = payload?.entry ? .0?.changes?.[0]?.value || payload || {};
    const nfmJson = _safeGet(v, ["messages", 0, "interactive", "nfm_reply", "response_json"]);
    if (nfmJson && typeof nfmJson === "string") {
      try { return JSON.parse(nfmJson); } catch (e) { /* ignore */ }
    }
    const msgInteractiveFlowData = _safeGet(v, ["messages", 0, "interactive", "flow", "data"]) || _safeGet(v, ["messages", 0, "interactive", "data"]) || _safeGet(v, ["messages", 0, "interactive"]);
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
  const text = (msg && ((msg.text && (msg.text.body || msg.text)) || msg.body || msg.body?.text || msg?.interactive?.button_reply?.id || msg?.interactive?.button_reply?.title)) || (typeof payload?.user_message === "string" ? payload.user_message : "") || "";
  return { msg, id: String(id || ""), from: String(from || ""), text: String(text || "") };
}

/* -------------------------
   GET: webhook verification
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
   POST: main webhook
------------------------- */
export async function POST(request) {
  console.log("[webhook] POST invoked");

  let rawText = "";
  try { rawText = await request.text(); } catch (e) { rawText = ""; }
  let payload = {};
  if (rawText) {
    try { payload = JSON.parse(rawText); } catch (e) { payload = {}; }
  }

  try { console.log("[webhook] payload snippet:", JSON.stringify(payload, null, 2).slice(0, 12000)); } catch (e) { }

  // signature check (non-fatal)
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

  // DB connect best-effort
  let dbAvailable = true;
  try { await dbConnect(); } catch (err) { dbAvailable = false; console.error("[webhook] DB connect failed:", err); }

  // persist raw event best-effort
  try {
    if (dbAvailable && typeof WebhookEvent?.create === "function") {
      const headersObj = Object.fromEntries(request.headers.entries());
      await WebhookEvent.create({ provider: "whatsapp", headers: headersObj, payload, receivedAt: new Date() }).catch((e) => console.warn("[webhook] WebhookEvent.create error:", e));
    }
  } catch (e) { console.warn("[webhook] save raw event failed:", e); }

  // canonicalize
  const { msg, id: msgId, from: phone, text: parsedText } = getCanonicalMessage(payload);
  console.log("[webhook] parsedMessage:", { msgId, phone, parsedText });

  if (!msgId && !phone) return NextResponse.json({ ok: true, note: "no-id-or-phone" });

  // save incoming message (best-effort)
  let savedMsg = null;
  try {
    if (dbAvailable && typeof Message?.create === "function") {
      const doc = { phone: digitsOnly(phone), from: msg?.from || "user", wa_message_id: msgId || null, type: parsedText ? "text" : "interactive", text: parsedText || "", raw: payload, status: null, meta: {}, conversationId: payload.conversation_id || null };
      if (msgId) {
        try { savedMsg = await Message.findOneAndUpdate({ wa_message_id: msgId }, { $setOnInsert: doc }, { upsert: true, new: true }).exec(); } catch (e) { savedMsg = await Message.create(doc).catch(() => null); }
      } else {
        savedMsg = await Message.create(doc).catch(() => null);
      }
    }
  } catch (e) { console.warn("[webhook] save message error:", e); }

  // lastMeta (DB) or memory fallback
  let lastMeta = null;
  try {
    if (dbAvailable && typeof Message?.findOne === "function") {
      const doc = await Message.findOne({ phone: digitsOnly(phone), "meta.state": { $exists: true } }).sort({ createdAt: -1 }).lean().exec();
      lastMeta = doc?.meta || null;
    }
  } catch (e) { console.warn("[webhook] lastMeta lookup failed:", e); lastMeta = null; }

  try {
    if (!lastMeta) {
      const mem = selectionMap.get(digitsOnly(phone));
      if (mem && (Array.isArray(mem.ids) || Array.isArray(mem.results))) lastMeta = { state: "AWAITING_LIST_SELECTION", listingIds: mem.ids || [], resultObjects: mem.results || [] };
    }
  } catch (e) { }

  // dedupe
  try {
    const alreadyHandled = await isAlreadyHandledMsg(dbAvailable, msgId);
    if (alreadyHandled) return NextResponse.json({ ok: true, note: "dedupe-skip" });
    await markHandledMsg(dbAvailable, msgId);
  } catch (e) { console.warn("[webhook] dedupe error:", e); }

  /* -------------------------
     Handle global menu/button commands:
     - menu_main, menu_contacts, view_images_<id>, menu_search (open search)
     These commands are handled immediately and return — preventing duplicate flows.
  ------------------------- */
  try {
    const rawCmd = String(parsedText || "").trim();

    // main menu
    if (/^menu_main$/i.test(rawCmd) || /^menu$/i.test(rawCmd) || /^main\s*menu$/i.test(rawCmd)) {
      await sendMainMenu(phone);
      return NextResponse.json({ ok: true, note: "main-menu-sent" }, { status: 200 });
    }

    // search commands: user typed "search" or tapped a "Search properties" button
    if (/^search\b/i.test(rawCmd) || /^search properties$/i.test(rawCmd) || rawCmd === "menu_search" || rawCmd === "open_search" || rawCmd === "msg_search") {
      // Single, consistent flow: try interactive flow; if fail, send one fallback buttons message and one instruction text
      const flowResp = await sendSearchFlow(phone, DEFAULT_FLOW_ID, {
        headerText: "Find rentals — filters",
        bodyText: "Please press continue to SEARCH.",
        footerText: "Search",
        screen: "SEARCH",
        cities: PREDEFINED_CITIES,
        suburbs: [{ id: "any", title: "Any" }, { id: "borrowdale", title: "Borrowdale" }, { id: "avondale", title: "Avondale" }],
      }).catch((e) => { console.warn("[sendSearchFlow] err:", e); return { error: e }; });

      // If flow failed, show a single interactive buttons fallback (not both flow+buttons)
      if (flowResp?.error) {
        await sendInteractiveButtons(phone, "Search options — choose:", [
          { id: "msg_search", title: "Search by message" },
          { id: "open_search", title: "Open search form" },
        ]);
      }

      // single instruction text
      await sendText(phone, "Fill the form to search for rentals (city, suburb, budget). When results appear you can tap a result or reply with the number (e.g. 1).");
      // persist note
      if (dbAvailable && savedMsg && savedMsg._id) await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.sentSearchFlow": true, "meta.sendResp": flowResp } }).catch(() => null);
      return NextResponse.json({ ok: true, note: "search-invoked", flowResp }, { status: 200 });
    }

    // view my contacts button
    if (/^menu_contacts$/i.test(rawCmd) || /^view my contacts$/i.test(rawCmd)) {
      // fetch contacts (DB first, then memory). similar logic to previous version but concise
      let listingIds = [];
      if (dbAvailable && typeof Message?.find === "function") {
        const docs = await Message.find({ phone: digitsOnly(phone), "meta.listingIdSelected": { $exists: true } }).lean().exec().catch(() => []);
        listingIds = Array.from(new Set(docs.map((d) => d?.meta?.listingIdSelected).filter(Boolean)));
      }
      if ((!listingIds || listingIds.length === 0) && selectionMap.has(digitsOnly(phone))) {
        const mem = selectionMap.get(digitsOnly(phone));
        if (mem && Array.isArray(mem.ids)) listingIds = Array.from(new Set(mem.ids.filter(Boolean)));
      }

      if (!listingIds || listingIds.length === 0) {
        await sendText(phone, "You haven't viewed any contacts yet. Reply 'hi' to start a search.");
        return NextResponse.json({ ok: true, note: "no-contacts" }, { status: 200 });
      }

      // fetch small summaries
      let foundListings = [];
      if (dbAvailable && typeof Listing?.find === "function") {
        try { foundListings = await Listing.find({ _id: { $in: listingIds } }).lean().exec().catch(() => []); } catch (e) { foundListings = []; }
      }
      const results = [];
      for (const id of listingIds) {
        let l = foundListings.find((x) => String(x._id) === String(id));
        if (!l) {
          const mem = selectionMap.get(digitsOnly(phone));
          if (mem && Array.isArray(mem.results)) l = mem.results.find((r) => getIdFromListing(r) === id || String(r._id) === id);
        }
        if (l) results.push({ id, title: l.title || "Listing", suburb: l.suburb || "", price: l.pricePerMonth || l.price || 0 });
      }

      const numbered = results.length ? results.map((r, i) => `${i + 1}) ${r.title} — ${r.suburb} — $${r.price}`).join("\n\n") : "No contact listings found.";
      await sendText(phone, `Your contacted listings:\n\n${numbered}`);
      const lightweight = results.map((r) => ({ _id: r.id, title: r.title, suburb: r.suburb, price: r.price }));
      selectionMap.set(digitsOnly(phone), { ids: listingIds, results: lightweight });
      await sendText(phone, "Reply with the number (e.g. 1) to view contact details again, or reply 'menu_main' for the main menu.");
      return NextResponse.json({ ok: true, note: "contacts-sent", count: listingIds.length }, { status: 200 });
    }

    // view images commands: raw like view_images_<id> or button id
    if (/^view_images_/i.test(rawCmd)) {
      const listingId = rawCmd.replace(/^view_images_/i, "").trim();
      if (!listingId) { await sendText(phone, "Image request missing listing id."); return NextResponse.json({ ok: true, note: "view-images-missing-id" }, { status: 200 }); }
      let listing = null;
      try { listing = await getListingById(listingId).catch(() => null); } catch (e) { listing = null; }
      if (!listing && typeof Listing?.findById === "function") listing = await Listing.findById(listingId).lean().exec().catch(() => null);
      if (!listing) {
        const mem = selectionMap.get(digitsOnly(phone));
        if (mem && Array.isArray(mem.results)) listing = mem.results.find((r) => getIdFromListing(r) === listingId || String(r._id) === listingId);
      }
      if (!listing) { await sendText(phone, "Sorry, listing not found."); return NextResponse.json({ ok: true, note: "view-images-notfound" }, { status: 200 }); }
      const images = Array.isArray(listing.images) ? listing.images.filter(Boolean) : (Array.isArray(listing.photos) ? listing.photos.filter(Boolean) : []);
      if (!images || images.length === 0) { await sendText(phone, "No photos available for this listing."); return NextResponse.json({ ok: true, note: "no-images" }, { status: 200 }); }
      await sendText(phone, `Photos for ${listing.title || "listing"}:\n${images.join("\n")}`);
      await sendInteractiveButtons(phone, "What next?", [
        { id: "menu_main", title: "Main menu" },
        { id: "menu_contacts", title: "View my contacts" },
      ]);
      return NextResponse.json({ ok: true, note: "images-sent", count: images.length }, { status: 200 });
    }
  } catch (e) {
    console.warn("[global-commands] error:", e);
  }

  /* -------------------------
     AWAITING_LIST_SELECTION handling (numeric selection / select_<id> / CONTACT <id>)
  ------------------------- */
  try {
    if (lastMeta && lastMeta.state === "AWAITING_LIST_SELECTION") {
      const raw = String(parsedText || "").trim();
      const idsFromMeta = Array.isArray(lastMeta.listingIds) ? lastMeta.listingIds : (selectionMap.get(digitsOnly(phone))?.ids || []);
      const resultsFromMeta = Array.isArray(lastMeta.resultObjects) ? lastMeta.resultObjects : (selectionMap.get(digitsOnly(phone))?.results || []);

      // interactive select_<id>
      if (/^select_/.test(raw)) {
        const listingId = raw.split("_")[1];
        if (listingId) {
          const ok = await tryRevealByIdOrCached(listingId, phone, idsFromMeta, resultsFromMeta, dbAvailable);
          selectionMap.delete(digitsOnly(phone));
          return NextResponse.json({ ok: true, note: ok ? "selection-handled-interactive" : "selection-notfound" }, { status: 200 });
        }
      }

      // numeric selection
      if (/^[1-9]\d*$/.test(raw)) {
        const idx = parseInt(raw, 10) - 1;
        const listingId = (idsFromMeta && idx >= 0 && idx < idsFromMeta.length) ? idsFromMeta[idx] : null;
        const cachedObj = (resultsFromMeta && idx >= 0 && idx < resultsFromMeta.length) ? resultsFromMeta[idx] : null;

        if (listingId) {
          const ok = await tryRevealByIdOrCached(listingId, phone, idsFromMeta, resultsFromMeta, dbAvailable);
          selectionMap.delete(digitsOnly(phone));
          return NextResponse.json({ ok: true, note: ok ? "selection-handled-number" : "selection-notfound" }, { status: 200 });
        }

        if (!listingId && cachedObj) {
          await revealFromObject(cachedObj, phone);
          const theId = getIdFromListing(cachedObj) || String(cachedObj._id || "");
          await sendInteractiveButtons(phone, "What next?", [
            { id: "menu_main", title: "Main menu" },
            { id: "menu_contacts", title: "View my contacts" },
            { id: `view_images_${theId}`, title: "View images" },
          ]);
          selectionMap.delete(digitsOnly(phone));
          return NextResponse.json({ ok: true, note: "selection-handled-number-cached" }, { status: 200 });
        }

        await sendText(phone, `Invalid selection. Reply with a number between 1 and ${idsFromMeta.length || resultsFromMeta.length || "N"}.`);
        return NextResponse.json({ ok: true, note: "selection-invalid" }, { status: 200 });
      }

      // CONTACT <id>
      const m = raw.match(/^contact\s+(.+)$/i);
      if (m) {
        const listingId = m[1].trim();
        if (listingId) {
          const ok = await tryRevealByIdOrCached(listingId, phone, idsFromMeta, resultsFromMeta, dbAvailable);
          selectionMap.delete(digitsOnly(phone));
          return NextResponse.json({ ok: true, note: ok ? "selection-handled-contactcmd" : "selection-notfound" }, { status: 200 });
        }
      }

      // not recognized
      await sendText(phone, "Please reply with the number of the listing (e.g. 1) or tap a result. Or send: CONTACT <LISTING_ID>.");
      return NextResponse.json({ ok: true, note: "selection-expected-number" }, { status: 200 });
    }
  } catch (e) { console.warn("[webhook] awaiting-list-selection error:", e); }

  /* -------------------------
     Greeting: user typed hi/hello -> send SEARCH flow + instruction (single sends)
  ------------------------- */
  try {
    const isHi = /^(hi|hello|hey|start)$/i.test(String(parsedText || "").trim());
    if (isHi) {
      const flowResp = await sendSearchFlow(phone, DEFAULT_FLOW_ID, {
        headerText: "Find rentals — filters",
        bodyText: "Please press continue to SEARCH.",
        footerText: "Search",
        screen: "SEARCH",
        cities: PREDEFINED_CITIES,
        suburbs: [{ id: "any", title: "Any" }, { id: "borrowdale", title: "Borrowdale" }, { id: "avondale", title: "Avondale" }],
      }).catch((e) => { console.warn("[sendSearchFlow] error:", e); return { error: e }; });

      if (flowResp?.error) {
        await sendInteractiveButtons(phone, "Search options:", [{ id: "msg_search", title: "Search by message" }, { id: "open_search", title: "Open search form" }]);
      }
      await sendText(phone, "Search opened ✅ Fill the form or reply with area and budget (e.g. Borrowdale, $200). When results appear you can tap a result or reply with the number (e.g. 1).");
      if (dbAvailable && savedMsg && savedMsg._id) await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.sentSearchFlow": true, "meta.sendResp": flowResp } }).catch(() => null);
      return NextResponse.json({ ok: true, note: "search-flow-sent", flowResp }, { status: 200 });
    }
  } catch (e) { console.error("[webhook] greeting error:", e); return NextResponse.json({ ok: true, note: "greeting-error" }, { status: 200 }); }

  /* -------------------------
     SEARCH -> RESULTS: parse flow submission, run search, send RESULTS flow + fallback
  ------------------------- */
  try {
    const requestedScreen = detectRequestedScreen(payload);
    if (requestedScreen === "SEARCH") {
      const flowData = getFlowDataFromPayload(payload);
      const q = String(flowData.q || flowData.keyword || flowData.query || `${flowData.suburb || ""} ${flowData.city || ""}`).trim();
      const minPrice = flowData.min_price || flowData.minPrice || flowData.min || null;
      const maxPrice = flowData.max_price || flowData.maxPrice || flowData.max || null;
      const minP = minPrice ? Number(String(minPrice).replace(/[^\d.]/g, "")) : null;
      const maxP = maxPrice ? Number(String(maxPrice).replace(/[^\d.]/g, "")) : null;

      let results = { listings: [], total: 0 };
      try { results = await searchPublishedListings({ q, minPrice: minP, maxPrice: maxP, perPage: 6 }); } catch (e) { console.warn("[webhook] searchPublishedListings failed:", e); results = { listings: [], total: 0 }; }

      const resultObjs = (results.listings || []).slice(0, 6);
      const ids = resultObjs.map(getIdFromListing);
      const numberedText = resultObjs.length ? resultObjs.map((l, i) => `${i + 1}) ${l.title || "Listing"} — ${l.suburb || ""} — $${l.pricePerMonth || l.price || "N/A"}`).join("\n\n") : "No matches found. Try a broader area or higher budget.";

      const resultsPayload = {
        screen: "RESULTS",
        headerText: "Search results",
        bodyText: numberedText,
        footerText: "Done",
        data: { resultsCount: resultObjs.length, listings: resultObjs.map((l) => ({ id: getIdFromListing(l), title: l.title || "", suburb: l.suburb || "", pricePerMonth: l.pricePerMonth || l.price || 0, bedrooms: l.bedrooms || "" })) },
      };

      const flowResp = await sendResultsFlow(phone, DEFAULT_FLOW_ID, resultsPayload).catch((e) => { console.warn("[sendResultsFlow] error:", e); return { error: e }; });

      // persist mapping to in-memory & DB meta
      try {
        selectionMap.set(digitsOnly(phone), { ids, results: resultObjs });
        if (dbAvailable && savedMsg && savedMsg._id) {
          await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.state": "AWAITING_LIST_SELECTION", "meta.listingIds": ids, "meta.resultObjects": resultObjs.map(r => ({ _id: getIdFromListing(r), title: r.title || "", suburb: r.suburb || "", pricePerMonth: r.pricePerMonth || r.price || 0, contactPhone: r.contactPhone || r.listerPhoneNumber || r.contactWhatsApp || "", contactName: r.contactName || "" })), "meta.sendResp_resultsFlow": flowResp } }, { upsert: true }).catch(() => null);
        }
      } catch (e) { console.warn("[webhook] save mapping failed:", e); }

      // fallback numbered text + single instruction
      if (flowResp?.error) {
        await sendText(phone, numberedText);
      }
      await sendText(phone, "To view contact details reply with the number (e.g. 1) or tap a result. Or send: CONTACT <LISTING_ID>.");
      return NextResponse.json({ ok: true, note: "search-handled-results-sent", ids, flowResp }, { status: 200 });
    }
  } catch (e) { console.error("[webhook] SEARCH->RESULTS error:", e); return NextResponse.json({ ok: true, note: "flow-search-error-logged" }, { status: 200 }); }

  // default no-op
  return NextResponse.json({ ok: true, note: "ignored-non-hi-non-search" }, { status: 200 });
}

/* -------------------------
   tryRevealByIdOrCached: attempts DB lookup then memory cached object
   After revealing, sends post-selection buttons (menu / contacts / images) once
------------------------- */
async function tryRevealByIdOrCached(listingId, phone, idsFromMeta = [], resultsFromMeta = [], dbAvailable = true) {
  try {
    if (!listingId) return false;

    // 1) helper
    try {
      const listing = await getListingById(listingId).catch(() => null);
      if (listing) { await revealFromObject(listing, phone); await sendPostSelectionButtons(listing, phone); await saveUserSelectedListing(phone, listingId, dbAvailable); return true; }
    } catch (e) { console.warn("[tryReveal] getListingById failed:", e); }

    // 2) Listing.findById
    try {
      if (typeof Listing?.findById === "function") {
        const dbListing = await Listing.findById(listingId).lean().exec().catch(() => null);
        if (dbListing) { await revealFromObject(dbListing, phone); await sendPostSelectionButtons(dbListing, phone); await saveUserSelectedListing(phone, listingId, dbAvailable); return true; }
      }
    } catch (e) { console.warn("[tryReveal] Listing.findById failed:", e); }

    // 3) resultsFromMeta mapping
    if (Array.isArray(idsFromMeta) && idsFromMeta.length > 0 && Array.isArray(resultsFromMeta)) {
      const idx = idsFromMeta.indexOf(listingId);
      if (idx >= 0 && resultsFromMeta[idx]) { await revealFromObject(resultsFromMeta[idx], phone); await sendPostSelectionButtons(resultsFromMeta[idx], phone); await saveUserSelectedListing(phone, listingId, dbAvailable); return true; }
    }

    // 4) defensive substring match
    if (Array.isArray(resultsFromMeta) && resultsFromMeta.length) {
      for (const r of resultsFromMeta) {
        const candidateId = getIdFromListing(r);
        if (candidateId && listingId && candidateId.includes(listingId)) { await revealFromObject(r, phone); await sendPostSelectionButtons(r, phone); await saveUserSelectedListing(phone, candidateId, dbAvailable); return true; }
      }
    }

    await sendText(phone, "Sorry, listing not found. If you still see results, please reply again with the number shown (e.g. 1).");
    return false;
  } catch (e) {
    console.error("[tryRevealByIdOrCached] unexpected error:", e);
    try { await sendText(phone, "Sorry — couldn't fetch contact details right now."); } catch { }
    return false;
  }
}

/* -------------------------
   send post-selection buttons (sent once)
------------------------- */
async function sendPostSelectionButtons(listing, phone) {
  try {
    const theId = getIdFromListing(listing) || String(listing._id || "");
    await sendInteractiveButtons(phone, "What next?", [
      { id: "menu_main", title: "Main menu" },
      { id: "menu_contacts", title: "View my contacts" },
      { id: `view_images_${theId}`, title: "View images" },
    ]);
  } catch (e) { console.warn("[sendPostSelectionButtons] error:", e); }
}

/* -------------------------
   save user selected listing into Message.meta (latest message)
------------------------- */
async function saveUserSelectedListing(phone, listingId, dbAvailable) {
  try {
    if (!dbAvailable) return;
    // update the most recent message for this phone
    if (typeof Message?.findOneAndUpdate === "function") {
      await Message.findOneAndUpdate({ phone: digitsOnly(phone) }, { $set: { "meta.listingIdSelected": listingId, "meta.state": "CONTACT_REVEALED" } }, { sort: { createdAt: -1 }, upsert: false }).exec().catch(() => null);
    }
  } catch (e) { /* ignore */ }
}

/* -------------------------
   revealFromObject: sends contact + listing summary (single concise sends)
------------------------- */
async function revealFromObject(listing, phone) {
  try {
    if (!listing) { await sendText(phone, "Sorry, listing not found."); return; }

    const title = listing.title || listing.name || "Listing";
    const suburb = listing.suburb || listing.location?.suburb || "";
    const price = listing.pricePerMonth != null ? `$${listing.pricePerMonth}` : (listing.price != null ? `$${listing.price}` : "N/A");
    const bedrooms = listing.bedrooms != null ? `${listing.bedrooms} bed(s)` : "";
    const description = listing.description ? String(listing.description).slice(0, 800) : "";
    const features = Array.isArray(listing.features) ? listing.features.filter(Boolean) : [];
    const images = Array.isArray(listing.images) ? listing.images.filter(Boolean) : [];

    const contactName = listing.contactName || listing.ownerName || "Owner";
    const contactPhone = listing.contactPhone || listing.listerPhoneNumber || listing.contactWhatsApp || "N/A";
    const contactWhatsApp = listing.contactWhatsApp || "";
    const contactEmail = listing.contactEmail || listing.email || "";

    const lines = [
      `Contact for: ${title}`,
      suburb ? `Suburb: ${suburb}` : null,
      bedrooms ? `Bedrooms: ${bedrooms}` : null,
      `Price: ${price}`,
      "",
      `Contact: ${contactName}`,
      `Phone: ${contactPhone}`,
    ].filter(Boolean);

    if (contactWhatsApp) lines.push(`WhatsApp: ${contactWhatsApp}`);
    if (contactEmail) lines.push(`Email: ${contactEmail}`);

    // single primary message, then optional smaller messages (keeps UI clean)
    await sendText(phone, lines.join("\n"));
    if (description) await sendText(phone, `Description:\n${description}`);
    if (features && features.length) await sendText(phone, `Features:\n• ${features.join("\n• ")}`);
    if (images.length) await sendText(phone, `Photos: ${images.length} image(s) available.`);

    await sendText(phone, "Reply CALL to contact the lister or reply with another result number (e.g. 2).");
  } catch (e) {
    console.error("[revealFromObject] error:", e);
    try { await sendText(phone, "Sorry — couldn't fetch contact details right now."); } catch { }
  }
}
