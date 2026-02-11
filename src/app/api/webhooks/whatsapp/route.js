// app/api/webhooks/whatsapp/route.js
import { NextResponse } from "next/server";
import crypto from "crypto";
import { dbConnect, WebhookEvent, Listing } from "@/lib/db";
import Message from "@/lib/Message";
import { getListingById, searchPublishedListings } from "@/lib/getListings";

export const runtime = "nodejs";

/* -------------------------
   Utilities
------------------------- */
function digitsOnly(v) { return String(v || "").replace(/\D/g, ""); }
function _safeGet(obj, path) { try { return path.reduce((o, k) => (o && o[k] != null ? o[k] : undefined), obj); } catch (e) { return undefined; } }

/* -------------------------
   Send dedupe cache (prevents identical sends to same phone within TTL)
------------------------- */
const messageSendCache = new Map(); // phone -> Map<hash, ts>
// raised TTL to reduce duplicates from quick re-deliveries
const TTL_MS = 10000;
function _now() { return Date.now(); }
function _hash(s) { try { return crypto.createHash("md5").update(String(s)).digest("hex"); } catch (e) { return String(s).slice(0, 128); } }
// canonicalize string for hashing (collapse whitespace)
function _normalizeForHash(s) { return String(s || "").replace(/\s+/g, " ").trim(); }
function _shouldSend(phone, hash) {
  if (!phone) return true;
  const p = messageSendCache.get(phone) || new Map();
  const ts = p.get(hash);
  const now = _now();
  if (ts && now - ts < TTL_MS) return false;
  p.set(hash, now);
  // cleanup
  for (const [k, t] of p) if (now - t > TTL_MS * 10) p.delete(k);
  messageSendCache.set(phone, p);
  return true;
}

/* -------------------------
   WhatsApp graph wrappers (single send per logical message)
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
  phoneNumber = digitsOnly(phoneNumber);
  if (!message || !String(message).trim()) return { error: "empty" };
  const apiToken = process.env.WHATSAPP_API_TOKEN;
  const phone_number_id = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;

  // normalize message to avoid tiny diffs producing different hashes
  const normalizedMessage = _normalizeForHash(message);
  const hash = _hash(`text:${normalizedMessage}`);
  if (!_shouldSend(phoneNumber, hash)) return { suppressed: true };

  if (!apiToken || !phone_number_id) {
    console.log("[sendText preview]", phoneNumber, normalizedMessage.slice(0, 300));
    return { error: "missing-credentials" };
  }
  const payload = { messaging_product: "whatsapp", to: phoneNumber, type: "text", text: { body: normalizedMessage } };
  return whatsappPost(phone_number_id, apiToken, payload);
}

async function sendInteractiveButtons(phoneNumber, bodyText, buttons = []) {
  phoneNumber = digitsOnly(phoneNumber);
  const apiToken = process.env.WHATSAPP_API_TOKEN;
  const phone_number_id = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;

  // build fallback combined instruction text (one message)
  const fallbackText = `${bodyText}\n\n${buttons.map((b, i) => `${i + 1}) ${b.title}`).join("\n")}\n\nReply with the number (e.g. 1) or the command.`;
  const interactive = {
    type: "button",
    body: { text: bodyText },
    action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })) },
  };

  // normalize interactive for hashing (use the fallback text form)
  const hash = _hash(`interactive:${_normalizeForHash(fallbackText)}`);
  if (!_shouldSend(phoneNumber, hash)) return { suppressed: true };

  if (!apiToken || !phone_number_id) {
    return sendText(phoneNumber, fallbackText);
  }

  const payload = { messaging_product: "whatsapp", to: phoneNumber, type: "interactive", interactive };
  const res = await whatsappPost(phone_number_id, apiToken, payload);
  if (res?.error) {
    // fallback single instruction message
    await sendText(phoneNumber, fallbackText);
  } else {
    // send a tiny follow-up instruction text for clarity (normalized so dedupe works)
    const instr = "Reply with a number (e.g. 1) or tap an option. You can also type the command shown in the buttons.";
    await sendText(phoneNumber, instr);
  }
  return res;
}

/* -------------------------
   Flow helpers (optional interactive flow)
------------------------- */
const DEFAULT_FLOW_ID = process.env.WHATSAPP_FLOW_ID || "";
const PREDEFINED_CITIES = [{ id: "harare", title: "Harare" }, { id: "bulawayo", title: "Bulawayo" }, { id: "mutare", title: "Mutare" }];

async function sendSearchFlow(phoneNumber, data = {}) {
  const apiToken = process.env.WHATSAPP_API_TOKEN;
  const phone_number_id = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;
  if (!DEFAULT_FLOW_ID || !apiToken || !phone_number_id) return { error: "no-flow" };

  const payloadData = {
    cities: (data.cities || PREDEFINED_CITIES).map((c) => ({ id: c.id, title: c.title })),
    suburbs: data.suburbs || [],
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
      body: { text: data.bodyText || "Press Continue to open the search form." },
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

  // dedupe interactive sends (normalize fallback)
  const fallback = `${interactivePayload.interactive.body?.text || ""} ${interactivePayload.interactive.footer?.text || ""}`.trim();
  const hash = _hash(`flow:${_normalizeForHash(fallback)}`);
  if (!_shouldSend(digitsOnly(phoneNumber), hash)) return { suppressed: true };

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
   In-memory selection map (phone -> { ids:[], results:[] })
------------------------- */
const selectionMap = new Map();

/* -------------------------
   ID normalizer (handles ObjectId shapes)
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
   Flow detection & parsing helpers (safe)
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
  const text = (msg && ((msg.text && (msg.text.body || msg.text)) || msg.body || msg.body?.text || msg?.interactive?.button_reply?.id || msg?.interactive?.button_reply?.title)) || (typeof payload?.user_message === "string" ? payload.user_message : "") || "";
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
  await sendInteractiveButtons(phone, "Welcome to CribMatch — choose an action:", buttons);
}

/* -------------------------
   POST: webhook handler
------------------------- */
export async function POST(request) {
  console.log("[webhook] POST invoked");

  // read raw body safely into rawBody (avoid name collision with later user text)
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

  // save raw event best-effort
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

  // dedupe incoming event
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
        // upsert fallback
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
     PRIORITY: Global commands (menu, list, search, view contacts, report)
  ------------------------- */

  if (/^menu$|^menu_main$|^main menu$/i.test(userRaw)) {
    await sendMainMenu(phone);
    return NextResponse.json({ ok: true, note: "menu-sent" });
  }

  if (cmd === "list" || cmd === "list a property" || cmd === "menu_list") {
    if (dbAvailable && savedMsg && savedMsg._id) {
      await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.state": "LISTING_WAIT_TITLE", "meta.listingDraft": {} } }).catch(() => null);
    }
    await sendText(phone, "Let's list your property. Step 1 of 4 — What's the property title? (e.g. 2-bed garden flat, Glen Norah). Reply with the title.");
    return NextResponse.json({ ok: true, note: "listing-started" });
  }

  if (cmd === "search" || cmd === "search properties" || cmd === "menu_search") {
    const flowResp = await sendSearchFlow(phone, { headerText: "Find rentals — filters", bodyText: "Press Continue to open the search form.", footerText: "Search", screen: "SEARCH", cities: PREDEFINED_CITIES }).catch(() => ({ error: "flow-error" }));
    if (flowResp?.error || flowResp?.suppressed) {
      await sendText(phone, "Search opened (text fallback). Reply with area and budget (eg. Borrowdale, $200) or type 'open_search' to try the form.");
    } else {
      // interactive form opened — short instruction
      await sendText(phone, "Search form opened. Fill and submit it. If you prefer, reply with area and budget (eg. Borrowdale, $200).");
    }
    return NextResponse.json({ ok: true, note: "search-invoked" });
  }

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
      await sendText(phone, "You haven't requested any contacts yet. Reply 'search' to look for listings.");
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
    const instruction = "\n\nReply with the number (e.g. 1) to view contact details again or type 'menu' to go back.";
    await sendText(phone, `${text}${instruction}`);
    selectionMap.set(phone, { ids: listingIds, results: summaries.map(s => ({ _id: s.id, title: s.title, suburb: s.suburb, price: s.price })) });
    return NextResponse.json({ ok: true, note: "past-messages-sent" });
  }

  if (cmd === "report listing" || cmd === "menu_report" || cmd === "report") {
    if (dbAvailable && savedMsg && savedMsg._id) await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.state": "REPORT_WAIT_ID" } }).catch(() => null);
    await sendText(phone, "Report a listing — Step 1 of 2: Reply with the listing ID you want to report (e.g. 60df12ab...).");
    return NextResponse.json({ ok: true, note: "report-started" });
  }

  /* -------------------------
     Listing creation flow handling (unchanged names)
  ------------------------- */
  if (lastMeta && lastMeta.state && String(lastMeta.state).startsWith("LISTING_")) {
    const state = lastMeta.state;
    if (state === "LISTING_WAIT_TITLE") {
      const title = userRaw;
      if (!title) { await sendText(phone, "Please reply with a valid title."); return NextResponse.json({ ok: true }); }
      if (dbAvailable && savedMsg && savedMsg._id) {
        await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.listingDraft.title": title, "meta.state": "LISTING_WAIT_SUBURB" } }).catch(() => null);
      }
      await sendText(phone, "Step 2 of 4: What suburb is the property in?");
      return NextResponse.json({ ok: true });
    }
    if (state === "LISTING_WAIT_SUBURB") {
      const suburb = userRaw;
      if (!suburb) { await sendText(phone, "Please reply with a valid suburb."); return NextResponse.json({ ok: true }); }
      if (dbAvailable && savedMsg && savedMsg._id) {
        await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.listingDraft.suburb": suburb, "meta.state": "LISTING_WAIT_PRICE" } }).catch(() => null);
      }
      await sendText(phone, "Step 3 of 4: What is the monthly price? (numbers only, e.g. 500)");
      return NextResponse.json({ ok: true });
    }
    if (state === "LISTING_WAIT_PRICE") {
      const priceMatch = userRaw.match(/(\d+(?:\.\d+)?)/);
      if (!priceMatch) { await sendText(phone, "Please reply with a numeric price (e.g. 500)."); return NextResponse.json({ ok: true }); }
      const price = Number(priceMatch[1]);
      if (dbAvailable && savedMsg && savedMsg._id) {
        await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.listingDraft.price": price, "meta.state": "LISTING_CONFIRM" } }).catch(() => null);
      }
      const draftDoc = (dbAvailable && savedMsg && savedMsg._id) ? (await Message.findById(savedMsg._id).lean().exec().catch(() => null)) : null;
      const draft = draftDoc?.meta?.listingDraft || {};
      const confirmText = `Please confirm your listing:\n\nTitle: ${draft.title || "<unknown>"}\nSuburb: ${draft.suburb || "<unknown>"}\nPrice: $${draft.price || price}\n\nReply YES to publish or NO to cancel.`;
      await sendText(phone, confirmText);
      return NextResponse.json({ ok: true });
    }
    if (state === "LISTING_CONFIRM") {
      if (/^yes$/i.test(userRaw)) {
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
            await sendText(phone, `Listing created ✅ ID: ${String(created._id)}\n\nReply 'menu' to return to main menu.`);
            return NextResponse.json({ ok: true, note: "listing-created" });
          } catch (e) {
            console.warn("[listing] create failed", e);
            await sendText(phone, "Couldn't create the listing right now. Try again later.");
            return NextResponse.json({ ok: true, note: "listing-create-failed" });
          }
        } else {
          await sendText(phone, "No listing draft found. Reply 'list' to start a new listing.");
          return NextResponse.json({ ok: true });
        }
      } else {
        if (dbAvailable && savedMsg && savedMsg._id) await Message.findByIdAndUpdate(savedMsg._id, { $unset: { "meta.listingDraft": "", "meta.state": "" } }).catch(() => null);
        await sendText(phone, "Listing cancelled. Reply 'menu' to return to main menu.");
        return NextResponse.json({ ok: true, note: "listing-cancelled" });
      }
    }
  }

  /* -------------------------
     Report flow
  ------------------------- */
  if (lastMeta && lastMeta.state && lastMeta.state === "REPORT_WAIT_ID") {
    const listingId = userRaw;
    if (!listingId) { await sendText(phone, "Please send a valid listing ID to report."); return NextResponse.json({ ok: true }); }
    if (dbAvailable && savedMsg && savedMsg._id) await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.report.listingId": listingId, "meta.state": "REPORT_WAIT_REASON" } }).catch(() => null);
    await sendText(phone, `Reporting ${listingId} — Step 2 of 2: Reply with the reason (e.g. 'spam', 'duplicate', 'wrong price', 'offensive').`);
    return NextResponse.json({ ok: true, note: "report-step2" });
  }
  if (lastMeta && lastMeta.state && lastMeta.state === "REPORT_WAIT_REASON") {
    const reason = userRaw || "unspecified";
    const listingId = lastMeta.report?.listingId || (dbAvailable && savedMsg && savedMsg._id ? (await Message.findById(savedMsg._id).lean().exec().catch(() => null))?.meta?.report?.listingId : null);
    if (dbAvailable && savedMsg && savedMsg._id) {
      await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.report.reason": reason, "meta.report.submittedAt": new Date(), "meta.state": "REPORT_SUBMITTED" } }).catch(() => null);
    }
    await sendText(phone, `Thanks — your report for listing ${listingId || ""} has been received. Our team will review it. Reply 'menu' to return to main menu.`);
    return NextResponse.json({ ok: true, note: "report-submitted" });
  }

  /* -------------------------
     Simple handler for "images <id>" requests (deduped)
  ------------------------- */
  if (/^images?\b/i.test(userRaw)) {
    const m = userRaw.match(/^images?\s+(.+)$/i);
    const listingId = m ? m[1].trim() : null;
    if (!listingId) {
      // dedupe will prevent repeated "Image request missing listing id."
      await sendText(phone, "Image request missing listing id.");
      return NextResponse.json({ ok: true, note: "images-missing-id" });
    }

    // dedupe image requests per listing
    const imgHash = _hash(`images:${listingId}`);
    if (!_shouldSend(phone, imgHash)) return NextResponse.json({ ok: true, note: "images-suppressed" });

    // try to fetch listing images and send a single combined message with URLs (or a friendly message)
    let listing = null;
    try { listing = await getListingById(listingId).catch(() => null); } catch (e) { listing = null; }
    if (!listing && typeof Listing?.findById === "function") listing = await Listing.findById(listingId).lean().exec().catch(() => null);
    const imgs = (listing && (listing.images || listing.photos || listing.photosUrls || [])) || [];
    if (!imgs || imgs.length === 0) {
      await sendText(phone, "No images found for this listing.");
      return NextResponse.json({ ok: true, note: "images-not-found" });
    }
    // send a single message including image URLs to avoid loops; platforms that support media can replace this with media API calls
    const imgText = [`Images for ${listing.title || "Listing"}:`].concat(imgs.slice(0, 6)).join("\n");
    await sendText(phone, `${imgText}\n\nReply 'menu' to go back.`);
    return NextResponse.json({ ok: true, note: "images-sent" });
  }

  /* -------------------------
     Selection-by-number handlers (unchanged behavior, using userRaw)
  ------------------------- */
  if (/^[1-9]\d*$/.test(userRaw) || /^select_/.test(userRaw) || /^contact\s+/i.test(userRaw)) {
    let listingId = null;
    const mem = selectionMap.get(phone);
    const lastIds = (lastMeta && Array.isArray(lastMeta.listingIds)) ? lastMeta.listingIds : (mem?.ids || []);
    const lastResults = (lastMeta && Array.isArray(lastMeta.resultObjects)) ? lastMeta.resultObjects : (mem?.results || []);
    if (/^select_/.test(userRaw)) {
      listingId = userRaw.split("_", 2)[1];
    } else if (/^contact\s+/i.test(userRaw)) {
      const m = userRaw.match(/^contact\s+(.+)$/i);
      listingId = m ? m[1].trim() : null;
    } else {
      const idx = parseInt(userRaw, 10) - 1;
      if (Array.isArray(lastIds) && idx >= 0 && idx < lastIds.length) listingId = lastIds[idx];
      else if (Array.isArray(lastResults) && idx >= 0 && idx < lastResults.length) listingId = getIdFromListing(lastResults[idx]) || lastResults[idx]._id;
    }

    if (!listingId) {
      await sendText(phone, "Couldn't determine the listing ID from your reply. Please reply with the number shown (e.g. 1) or 'menu' for main menu.");
      return NextResponse.json({ ok: true, note: "selection-unknown" });
    }

    // try to fetch listing
    let listing = null;
    try { listing = await getListingById(listingId).catch(() => null); } catch (e) { listing = null; }
    if (!listing && dbAvailable && typeof Listing?.findById === "function") listing = await Listing.findById(listingId).lean().exec().catch(() => null);
    if (!listing && Array.isArray(lastResults)) listing = lastResults.find((r) => getIdFromListing(r) === listingId || String(r._id) === listingId) || null;
    if (!listing) {
      await sendText(phone, "Sorry, listing not found. If you still see results, reply with the number shown (e.g. 1).");
      return NextResponse.json({ ok: true, note: "listing-not-found" });
    }

    const title = listing.title || "Listing";
    const suburb = listing.suburb || "";
    const price = listing.pricePerMonth != null ? `$${listing.pricePerMonth}` : (listing.price != null ? `$${listing.price}` : "N/A");
    const contactName = listing.contactName || listing.ownerName || "Owner";
    const contactPhone = listing.contactPhone || listing.listerPhoneNumber || listing.contactWhatsApp || "N/A";

    const msgText = [
      `Contact for: ${title}`,
      suburb ? `Suburb: ${suburb}` : null,
      `Price: ${price}`,
      "",
      `Contact: ${contactName}`,
      `Phone: ${contactPhone}`,
      "",
      `Reply 'menu' to go to main menu — Reply 'images ${getIdFromListing(listing)}' to view images (URLs), or reply with another result number.`,
    ].filter(Boolean).join("\n");

    await sendText(phone, msgText);

    if (dbAvailable && savedMsg && savedMsg._id) {
      await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.listingIdSelected": getIdFromListing(listing) } }).catch(() => null);
    }

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
     Simple text-search fallback (unchanged)
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
        await sendText(phone, "No matches found. Try a broader area or higher budget, or reply 'menu' to go back.");
        return NextResponse.json({ ok: true, note: "search-no-results" });
      }
      const ids = items.map(getIdFromListing);
      const numbered = items.map((l, i) => `${i + 1}) ${l.title || "Listing"} — ${l.suburb || ""} — $${l.pricePerMonth || l.price || "N/A"} — ID:${getIdFromListing(l)}`).join("\n\n");
      const instruction = "\n\nReply with the number (e.g. 1) to view contact details, or 'menu' for main menu.";
      await sendText(phone, `${numbered}${instruction}`);
      selectionMap.set(phone, { ids, results: items });
      if (dbAvailable && savedMsg && savedMsg._id) {
        await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.state": "AWAITING_LIST_SELECTION", "meta.listingIds": ids, "meta.resultObjects": items } }).catch(() => null);
      }
      return NextResponse.json({ ok: true, note: "search-results-sent" });
    }
  }

  // default fallback: send main menu so user isn't stuck
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
