// app/api/webhooks/whatsapp/route.js
//
// Updated: Robust ID mapping + numeric selection fallback to cached result objects.
// Drop into app/api/webhooks/whatsapp/route.js
//

import { NextResponse } from "next/server";
import crypto from "crypto";
import { dbConnect, WebhookEvent, Listing } from "@/lib/db";
import Message from "@/lib/Message";
import { getListingById, searchPublishedListings } from "@/lib/getListings";

export const runtime = "nodejs";

/* -------------------------
   Small helpers
------------------------- */
function digitsOnly(v) {
  return String(v || "").replace(/\D/g, "");
}

/**
 * Robustly extract a string ID from a listing object returned by searchPublishedListings.
 * Handles:
 * - l._id as string
 * - l._id as ObjectId (with .toString)
 * - l._id as { $oid: "..." }
 * - l.id
 */
function getIdFromListing(l) {
  if (!l) return "";
  if (typeof l._id === "string" && l._id) return l._id;
  if (l._id && typeof l._id === "object") {
    if (typeof l._id.toString === "function") {
      try {
        const s = l._id.toString();
        if (s && s !== "[object Object]") return s;
      } catch (e) { /* ignore */ }
    }
    if (l._id.$oid) return String(l._id.$oid);
  }
  if (l.id && typeof l.id === "string") return l.id;
  if (l._id && typeof l._id === "number") return String(l._id);
  return "";
}

/* -------------------------
   WhatsApp API wrappers (best-effort)
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
    console.log("[sendText] missing credentials — would send:", message.slice(0, 500));
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

async function sendFlowStart(phoneNumber, flowId, data = {}) {
  const apiToken = process.env.WHATSAPP_API_TOKEN;
  const phone_number_id = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;
  if (!apiToken || !phone_number_id) return { error: "missing-credentials" };

  const payloadData = data.payloadData || data;
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

async function sendFlowNavigate(phoneNumber, flowId, screen = "RESULTS", data = {}) {
  return sendFlowStart(phoneNumber, flowId, { screen, ...data });
}

/* -------------------------
   Dedupe helpers (DB backed, memory fallback)
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
   In-memory selection map (phone -> { ids:[], results:[] })
   Stored as:
     selectionMap.set(phone, { ids: ['id1','id2'], results: [<original listing objects>] })
   This is used as fallback when DB/meta not accessible or when id shape is unexpected.
------------------------- */
const selectionMap = new Map();

/* -------------------------
   Flow detection & parsing helpers
   (same robust detection used earlier)
------------------------- */
function _safeGet(obj, path) {
  try { return path.reduce((o, k) => (o && o[k] != null ? o[k] : undefined), obj); } catch (e) { return undefined; }
}

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
    _safeGet(v, ["messages", 0, "interactive", "flow", "screen"]),
  ];

  for (const c of candidates) {
    if (!c) continue;
    if (typeof c === "string") {
      const s = c.trim();
      if (s) return s.toUpperCase();
    } else if (typeof c === "object") {
      if (c.screen && typeof c.screen === "string") return c.screen.toUpperCase();
      if (Object.keys(c).some(k => ["city", "q", "min_price"].includes(k))) return "SEARCH";
    }
  }

  // also infer by presence of flow data
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

    const interactiveData = _safeGet(v, ["messages", 0, "interactive", "flow", "data"]) ||
      _safeGet(v, ["messages", 0, "interactive", "data"]) ||
      _safeGet(v, ["messages", 0, "interactive"]);

    if (interactiveData && typeof interactiveData === "object") return interactiveData;

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
      out.q = maybe("q") ?? maybe("keyword") ?? maybe("query");
      out.min_price = maybe("min_price") ?? maybe("minPrice") ?? maybe("min");
      out.max_price = maybe("max_price") ?? maybe("maxPrice") ?? maybe("max");
      Object.assign(out, c);
      return out;
    }

    return {};
  } catch (e) {
    return {};
  }
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

  if (!expectedToken) {
    return new Response("Missing verify token", { status: 500, headers: { "Cache-Control": "no-store" } });
  }

  if (mode === "subscribe" && token && challenge && token === expectedToken) {
    return new Response(challenge, { status: 200, headers: { "Cache-Control": "no-store" } });
  }

  return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
}

/* -------------------------
   POST: main webhook flow
------------------------- */
export async function POST(request) {
  console.log("[webhook] POST invoked");

  // 1) read raw body
  let rawText = "";
  try { rawText = await request.text(); } catch (e) { rawText = ""; }
  let payload = {};
  if (rawText) {
    try { payload = JSON.parse(rawText); } catch (e) { payload = {}; }
  }

  // debug snippet
  try { console.log("[webhook] snippet:", JSON.stringify(payload, null, 2).slice(0, 12000)); } catch (e) { /* ignore */ }

  // 2) optional signature validation
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

  // 3) DB connect best-effort
  let dbAvailable = true;
  try { await dbConnect(); } catch (err) { dbAvailable = false; console.error("[webhook] DB connect failed (continuing without persistence):", err); }

  // 4) persist raw event
  try {
    if (dbAvailable && typeof WebhookEvent?.create === "function") {
      const headersObj = Object.fromEntries(request.headers.entries());
      await WebhookEvent.create({ provider: "whatsapp", headers: headersObj, payload, receivedAt: new Date() }).catch((e) => {
        console.warn("[webhook] WebhookEvent.create error:", e);
      });
    }
  } catch (e) { console.warn("[webhook] save raw event failed:", e); }

  // 5) canonicalize message
  const { msg, id: msgId, from: phone, text: parsedText } = getCanonicalMessage(payload);
  console.log("[webhook] parsedMessage:", { msgId, phone, parsedText });

  if (!msgId && !phone) {
    console.log("[webhook] no id or phone found — ignoring");
    return NextResponse.json({ ok: true, note: "no-id-or-phone" });
  }

  // 6) save incoming Message (best-effort)
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
    }
  } catch (e) { console.warn("[webhook] save message error:", e); }

  // 7) get lastMeta for this phone (DB) and fallback to selectionMap
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
      if (mem && (Array.isArray(mem.ids) || Array.isArray(mem.results))) {
        lastMeta = { state: "AWAITING_LIST_SELECTION", listingIds: mem.ids || [], resultObjects: mem.results || [] };
      }
    }
  } catch (e) { /* ignore */ }

  // 8) dedupe
  try {
    const already = await isAlreadyHandledMsg(dbAvailable, msgId);
    if (already) return NextResponse.json({ ok: true, note: "dedupe-skip" });
    await markHandledMsg(dbAvailable, msgId);
  } catch (e) { console.warn("[webhook] dedupe error:", e); }

  /* -------------------------
     9) If waiting for list selection: handle numeric / select_<id> / CONTACT <id>
  ------------------------- */
  try {
    if (lastMeta && lastMeta.state === "AWAITING_LIST_SELECTION") {
      const raw = String(parsedText || "").trim();
      // try to get ids/resultObjects from meta or memory
      const idsFromMeta = Array.isArray(lastMeta.listingIds) ? lastMeta.listingIds : (selectionMap.get(digitsOnly(phone))?.ids || []);
      const resultsFromMeta = Array.isArray(lastMeta.resultObjects) ? lastMeta.resultObjects : (selectionMap.get(digitsOnly(phone))?.results || []);

      console.log("[webhook] AWAITING_LIST_SELECTION: idsFromMeta:", idsFromMeta);

      // interactive reply id like select_<id>
      if (/^select_/.test(raw)) {
        const listingId = raw.split("_")[1];
        if (listingId) {
          console.log("[webhook] interactive select for id:", listingId);
          // Try to reveal using DB first, else fallback to cached result object
          const ok = await tryRevealByIdOrCached(listingId, phone, idsFromMeta, resultsFromMeta);
          selectionMap.delete(digitsOnly(phone));
          return NextResponse.json({ ok: true, note: ok ? "selection-handled-interactive" : "selection-handled-interactive-notfound" }, { status: 200 });
        }
      }

      // numeric selection e.g., "1"
      if (/^[1-9]\d*$/.test(raw)) {
        const idx = parseInt(raw, 10) - 1;
        if (!Array.isArray(idsFromMeta) || idsFromMeta.length === 0) {
          console.log("[webhook] No idsFromMeta available; resultsFromMeta length:", resultsFromMeta.length);
        }
        const listingId = idsFromMeta && idx >= 0 && idx < idsFromMeta.length ? idsFromMeta[idx] : null;
        const cachedObj = resultsFromMeta && idx >= 0 && idx < resultsFromMeta.length ? resultsFromMeta[idx] : null;

        console.log("[webhook] numeric selection idx:", idx, "listingId:", listingId, "hasCachedObj:", !!cachedObj);

        if (listingId) {
          const ok = await tryRevealByIdOrCached(listingId, phone, idsFromMeta, resultsFromMeta);
          selectionMap.delete(digitsOnly(phone));
          return NextResponse.json({ ok: true, note: ok ? "selection-handled-number" : "selection-handled-number-notfound" }, { status: 200 });
        }

        // if no listingId string but we have cached object with contact fields, use it
        if (!listingId && cachedObj) {
          console.log("[webhook] falling back to cached object for numeric selection");
          await revealFromObject(cachedObj, phone);
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
          const ok = await tryRevealByIdOrCached(listingId, phone, idsFromMeta, resultsFromMeta);
          selectionMap.delete(digitsOnly(phone));
          return NextResponse.json({ ok: true, note: ok ? "selection-handled-contactcmd" : "selection-handled-contactcmd-notfound" }, { status: 200 });
        }
      }

      // Not recognised
      await sendText(phone, "To view contact details reply with the number of the listing (e.g. 1) or tap a result. Or send: CONTACT <LISTING_ID>.");
      return NextResponse.json({ ok: true, note: "selection-expected-number" }, { status: 200 });
    }
  } catch (e) {
    console.warn("[webhook] AWAITING_LIST_SELECTION error:", e);
  }

  /* -------------------------
     10) If user sends "hi" -> open SEARCH flow and instruct
  ------------------------- */
  try {
    const isHi = /^(hi|hello|hey|start)$/i.test(String(parsedText || "").trim());
    if (isHi) {
      const flowId = process.env.WHATSAPP_FLOW_ID || "1534021024566343";
      const resp = await sendFlowNavigate(phone, flowId, {
        headerText: "Find rentals — filters",
        bodyText: "Please press continue to SEARCH.",
        footerText: "Search",
        payloadData: { cities: [{ id: "harare", title: "Harare" }, { id: "bulawayo", title: "Bulawayo" }] },
      });
      console.log("[webhook] search flow sent resp:", resp);

      // explicit instruction message (user-visible)
      await sendText(phone, "Search opened ✅\nFill the form to search (city, suburb, budget). When results appear reply with the number (e.g. 1) to view contact details.");

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
     11) Handle SEARCH flow submission -> run search -> send RESULTS
  ------------------------- */
  try {
    const requested = detectRequestedScreen(payload);
    console.log("[webhook] detectRequestedScreen ->", requested);
    if (requested === "SEARCH") {
      const flowData = getFlowDataFromPayload(payload);
      console.log("[webhook] flowData:", flowData);

      const q = String(flowData.q || flowData.keyword || flowData.query || `${flowData.suburb || ""} ${flowData.city || ""}`).trim();
      const minPrice = flowData.min_price || flowData.minPrice || flowData.min || null;
      const maxPrice = flowData.max_price || flowData.maxPrice || flowData.max || null;
      const minP = minPrice ? Number(String(minPrice).replace(/[^\d.]/g, "")) : null;
      const maxP = maxPrice ? Number(String(maxPrice).replace(/[^\d.]/g, "")) : null;

      // run your search helper
      let results = { listings: [], total: 0 };
      try {
        results = await searchPublishedListings({ q, minPrice: minP, maxPrice: maxP, perPage: 6 });
      } catch (e) {
        console.warn("[webhook] searchPublishedListings failed:", e);
      }

      const resultObjs = (results.listings || []).slice(0, 6);
      const ids = resultObjs.map(getIdFromListing);
      // build friendly numbered text for fallback
      const numberedText = resultObjs.length
        ? resultObjs.map((l, i) => `${i + 1}) ${l.title || "Listing"} — ${l.suburb || ""} — $${l.pricePerMonth || l.price || "N/A"}`).join("\n\n")
        : "No matches found. Try a broader area or higher budget.";

      // Send RESULTS flow (if using flows)
      const flowResp = await sendFlowNavigate(phone, process.env.WHATSAPP_FLOW_ID || "1534021024566343", {
        screen: "RESULTS",
        headerText: "Search results",
        bodyText: numberedText,
        footerText: "Done",
        payloadData: { resultsCount: resultObjs.length, listings: resultObjs },
      });
      console.log("[webhook] sendFlowNavigate(RESULTS) resp:", flowResp);

      // Persist mapping (DB meta + in-memory)
      try {
        // always update in-memory map for immediate use
        selectionMap.set(digitsOnly(phone), { ids, results: resultObjs });

        if (dbAvailable && savedMsg && savedMsg._id) {
          await Message.findByIdAndUpdate(savedMsg._id, {
            $set: {
              "meta.state": "AWAITING_LIST_SELECTION",
              "meta.listingIds": ids,
              "meta.resultObjects": resultObjs.map(r => ({
                // store only lightweight fields to avoid huge payloads
                _id: getIdFromListing(r),
                title: r.title || "",
                suburb: r.suburb || "",
                pricePerMonth: r.pricePerMonth || r.price || 0,
                contactPhone: r.contactPhone || r.listerPhoneNumber || r.contactWhatsApp || "",
                contactName: r.contactName || "",
              })),
              "meta.sendResp_resultsFlow": flowResp,
            }
          }, { upsert: true }).catch(() => null);
        }
      } catch (e) {
        console.warn("[webhook] saving mapping failed:", e);
      }

      // Always send fallback numbered text + instructions so user knows how to pick
      try {
        await sendText(phone, numberedText);
        await sendText(phone, "To view contact details reply with the number of the listing (e.g. 1) or tap a result. Or reply: CONTACT <LISTING_ID>.");
      } catch (e) {
        console.warn("[webhook] sending fallback text failed:", e);
      }

      return NextResponse.json({ ok: true, note: "search-handled-results-sent", ids, flowResp }, { status: 200 });
    }
  } catch (e) {
    console.error("[webhook] SEARCH -> RESULTS error:", e);
    return NextResponse.json({ ok: true, note: "flow-search-error-logged" }, { status: 200 });
  }

  // default safe no-op
  return NextResponse.json({ ok: true, note: "ignored-non-hi-non-search" }, { status: 200 });
}

/* -------------------------
   Try reveal by DB id, if that fails fall back to cached result object
   Returns true if something was sent, false if not.
------------------------- */
async function tryRevealByIdOrCached(listingId, phone, idsFromMeta = [], resultsFromMeta = []) {
  try {
    if (listingId) {
      console.log("[tryRevealByIdOrCached] Attempting DB lookup for id:", listingId);
      // prefer your helper
      try {
        const listing = await getListingById(listingId);
        if (listing) {
          await revealFromObject(listing, phone);
          return true;
        }
      } catch (e) {
        console.warn("[tryRevealByIdOrCached] getListingById failed:", e);
      }

      // fallback: try Listing.findById
      try {
        if (typeof Listing?.findById === "function") {
          const dbListing = await Listing.findById(listingId).lean().exec().catch(() => null);
          if (dbListing) {
            await revealFromObject(dbListing, phone);
            return true;
          }
        }
      } catch (e) {
        console.warn("[tryRevealByIdOrCached] Listing.findById failed:", e);
      }

      // fallback: maybe listingId is a short id or present as string in resultsFromMeta
      const idx = (idsFromMeta || []).indexOf(listingId);
      if (idx >= 0 && resultsFromMeta && resultsFromMeta[idx]) {
        await revealFromObject(resultsFromMeta[idx], phone);
        return true;
      }

      // fallback: try to find by matching id substring in result objects (defensive)
      if (resultsFromMeta && resultsFromMeta.length) {
        for (const r of resultsFromMeta) {
          const candidateId = getIdFromListing(r);
          if (candidateId && candidateId.includes(listingId)) {
            await revealFromObject(r, phone);
            return true;
          }
        }
      }
    }

    // nothing found
    console.warn("[tryRevealByIdOrCached] listing not found for id:", listingId, "idsFromMeta:", idsFromMeta, "resultsLen:", (resultsFromMeta || []).length);
    await sendText(phone, "Sorry, listing not found. If you still see results, please reply again with the number shown (e.g. 1).");
    return false;
  } catch (e) {
    console.error("[tryRevealByIdOrCached] unexpected error:", e);
    try { await sendText(phone, "Sorry — couldn't fetch contact details right now."); } catch { }
    return false;
  }
}

/* -------------------------
   Build and send contact/listing info from a listing-like object
   This accepts either a DB Listing doc or a "search result" object and sends user-friendly messages.
------------------------- */
async function revealFromObject(listing, phone) {
  try {
    if (!listing) {
      await sendText(phone, "Sorry, listing not found.");
      return;
    }

    // Prefer canonical fields from your Listing schema
    const title = listing.title || listing.name || "Listing";
    const suburb = listing.suburb || listing.location?.suburb || "";
    const price = listing.pricePerMonth != null ? `$${listing.pricePerMonth}` : (listing.price != null ? `$${listing.price}` : "N/A");
    const bedrooms = listing.bedrooms != null ? `${listing.bedrooms} bed(s)` : "";
    const propertyType = listing.propertyType || listing.property_type || "";
    const propertyCategory = listing.propertyCategory || listing.property_category || "";
    const description = listing.description ? String(listing.description).slice(0, 800) : "";
    const features = Array.isArray(listing.features) ? listing.features.filter(Boolean) : [];
    const images = Array.isArray(listing.images) ? listing.images.filter(Boolean) : [];

    // contact fields
    const contactName = listing.contactName || listing.ownerName || "Owner";
    const contactPhone = listing.contactPhone || listing.listerPhoneNumber || listing.contactWhatsApp || "N/A";
    const contactWhatsApp = listing.contactWhatsApp || "";
    const contactEmail = listing.contactEmail || listing.email || "";

    const primary = [
      `Contact for: ${title}`,
      suburb ? `Suburb: ${suburb}` : null,
      propertyType ? `Type: ${propertyType}` : null,
      propertyCategory ? `Category: ${propertyCategory}` : null,
      bedrooms ? `Bedrooms: ${bedrooms}` : null,
      `Price: ${price}`,
      "",
      `Contact: ${contactName}`,
      `Phone: ${contactPhone}`,
    ].filter(Boolean);

    if (contactWhatsApp) primary.push(`WhatsApp: ${contactWhatsApp}`);
    if (contactEmail) primary.push(`Email: ${contactEmail}`);

    await sendText(phone, primary.join("\n"));

    if (description) await sendText(phone, `Description:\n${description}`);
    if (features && features.length) await sendText(phone, `Features:\n• ${features.join("\n• ")}`);
    if (images.length) await sendText(phone, `Photos: ${images.length} image(s) available.`);

    await sendText(phone, "Reply CALL to contact the lister or reply with another result number (e.g. 2) to view another listing.");
  } catch (e) {
    console.error("[revealFromObject] error:", e);
    try { await sendText(phone, "Sorry — couldn't fetch contact details right now."); } catch { }
  }
}
