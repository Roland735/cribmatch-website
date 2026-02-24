// app/api/webhooks/whatsapp/route.js
//
// Full webhook for CribMatch with dedupe + flow fallback + debug logging.
// Env required (recommended):
// - WHATSAPP_API_TOKEN
// - WHATSAPP_PHONE_NUMBER_ID (or WHATSAPP_PHONE_ID)
// - WHATSAPP_FLOW_ID (optional; fallback ID included)
// - WHATSAPP_WEBHOOK_VERIFY_TOKEN
// - APP_SECRET (optiona
import { NextResponse } from "next/server";
import crypto from "crypto";
import mongoose from "mongoose";
import { dbConnect, WebhookEvent, Listing, Purchase } from "@/lib/db";
import Message from "@/lib/Message";
import { getListingById, searchPublishedListings, getListingFacets, getListingByShortId } from "@/lib/getListings";
import { supabaseAdmin } from "@/lib/supabase";

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

async function _shouldSendDb(phone, hash) {
  try {
    if (!phone || !hash) return true;
    if (!process.env.MONGODB_URI) return true;
    await dbConnect();

    // 1. Global Debounce (5 seconds) - prevent double-send across instances/restarts
    const DEBOUNCE_MS = 5000;
    const recent = await Message.findOne({
      phone,
      "meta.direction": "outbound",
      "meta.hash": hash,
      createdAt: { $gt: new Date(Date.now() - DEBOUNCE_MS) }
    }).select("_id").lean().exec().catch(() => null);

    if (recent) return false;

    // 2. Per-Message Dedupe (prevent re-sending for same inbound trigger)
    const lastInbound = await Message.findOne({ phone, "meta.direction": "inbound" })
      .sort({ createdAt: -1 })
      .select({ createdAt: 1 })
      .lean()
      .exec()
      .catch(() => null);

    const q = { phone, "meta.direction": "outbound", "meta.hash": hash };
    if (lastInbound?.createdAt) q.createdAt = { $gt: lastInbound.createdAt };

    const existing = await Message.findOne(q).select({ _id: 1 }).lean().exec().catch(() => null);
    return !existing;
  } catch (e) {
    return true;
  }
}

async function _recordOutboundMessage({ phone, wa_message_id, type, text, raw, meta }) {
  try {
    if (!process.env.MONGODB_URI) return null;
    await dbConnect();
    if (typeof Message?.create !== "function") return null;

    return await Message.create({
      phone: digitsOnly(phone),
      from: "system",
      wa_message_id: wa_message_id || null,
      type: type || "text",
      text: String(text || "").slice(0, 4000),
      raw: raw || null,
      meta: { ...(meta || {}), direction: "outbound" },
    });
  } catch (e) {
    return null;
  }
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

async function sendImage(phoneNumber, imageUrl, caption = "") {
  const apiToken = process.env.WHATSAPP_API_TOKEN;
  const phone_number_id = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;
  const phone = digitsOnly(phoneNumber);
  const content = String(imageUrl || "").trim();
  if (!content) return { error: "empty" };

  const isUrl = content.startsWith("http://") || content.startsWith("https://");
  const normalizedCaption = String(caption || "").trim();
  const hash = _hash(`image:${_normalizeForHash(content)}:${_normalizeForHash(normalizedCaption)}`);

  if (!_shouldSend(phone, hash, TTL_INTERACTIVE_MS)) {
    console.log("[sendImage] suppressed duplicate image to", phone);
    return { suppressed: true };
  }
  if (!(await _shouldSendDb(phone, hash))) {
    console.log("[sendImage] suppressed duplicate image (db) to", phone);
    return { suppressed: true };
  }

  if (!apiToken || !phone_number_id) {
    const fallback = normalizedCaption ? `${normalizedCaption}\n${content}` : content;
    return sendText(phoneNumber, fallback);
  }

  const imageObj = isUrl ? { link: content } : { id: content };
  if (normalizedCaption) imageObj.caption = normalizedCaption.slice(0, 1024);

  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "image",
    image: imageObj,
  };

  const res = await whatsappPost(phone_number_id, apiToken, payload);
  const waid = res?.messages?.[0]?.id || null;
  if (!res?.error) {
    await _recordOutboundMessage({
      phone,
      wa_message_id: waid,
      type: "image",
      text: normalizedCaption,
      raw: payload,
      meta: { hash, imageUrl: content },
    });
  } else {
    console.error("[sendImage] failed:", JSON.stringify(res));
  }
  return res;
}

async function sendImages(phoneNumber, imageUrls = [], opts = {}) {
  const urls = Array.isArray(imageUrls) ? imageUrls.filter(Boolean).map(String).map((u) => u.trim()).filter(Boolean) : [];
  const max = typeof opts.max === "number" ? Math.max(1, Math.min(10, Math.floor(opts.max))) : 6;
  const caption = String(opts.caption || "").trim();
  const toSend = urls.slice(0, max);

  if (!toSend.length) return { ok: false, sent: 0 };

  let sent = 0;
  for (let i = 0; i < toSend.length; i += 1) {
    const cap = i === 0 && caption ? caption : "";
    const res = await sendImage(phoneNumber, toSend[i], cap).catch(() => null);
    if (res && !res.error) sent += 1;
  }
  return { ok: true, sent };
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
  if (!(await _shouldSendDb(phone, hash))) {
    console.log("[sendText] suppressed duplicate text (db) to", phone);
    return { suppressed: true };
  }

  if (!apiToken || !phone_number_id) {
    console.log("[sendText preview]", phone, normalizedMessage.slice(0, 300));
    return { error: "missing-credentials" };
  }

  const payload = { messaging_product: "whatsapp", to: phone, type: "text", text: { body: message } };
  const res = await whatsappPost(phone_number_id, apiToken, payload);
  const waid = res?.messages?.[0]?.id || null;
  if (!res?.error) {
    await _recordOutboundMessage({
      phone,
      wa_message_id: waid,
      type: "text",
      text: message,
      raw: payload,
      meta: { hash },
    });
  }
  return res;
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
  if (!(await _shouldSendDb(phone, hash))) {
    console.log("[sendInteractiveButtons] suppressed duplicate interactive (db) to", phone);
    return { suppressed: true };
  }

  if (!apiToken || !phone_number_id) {
    return sendText(phoneNumber, fallbackText);
  }

  const payload = { messaging_product: "whatsapp", to: phone, type: "interactive", interactive };
  const res = await whatsappPost(phone_number_id, apiToken, payload);
  const waid = res?.messages?.[0]?.id || null;
  if (!res?.error) {
    await _recordOutboundMessage({
      phone,
      wa_message_id: waid,
      type: "interactive",
      text: fallbackText,
      raw: payload,
      meta: { hash, interactiveType: "button" },
    });
  }
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
  if (!(await _shouldSendDb(phone, hash))) {
    console.log("[sendInteractiveList] suppressed duplicate interactive list (db) to", phone);
    return { suppressed: true };
  }

  if (!apiToken || !phone_number_id) {
    return sendText(phoneNumber, fallbackText);
  }

  const payload = { messaging_product: "whatsapp", to: phone, type: "interactive", interactive };
  const res = await whatsappPost(phone_number_id, apiToken, payload);
  const waid = res?.messages?.[0]?.id || null;
  if (!res?.error) {
    await _recordOutboundMessage({
      phone,
      wa_message_id: waid,
      type: "interactive",
      text: fallbackText,
      raw: payload,
      meta: { hash, interactiveType: "list" },
    });
  }
  if (res?.error) {
    await sendText(phoneNumber, fallbackText).catch(() => null);
  }
  return res;
}

async function showDeletePhotosMenu(phone, listingId, selectedIndices = []) {
  if (mongoose.connection.readyState === 1 && typeof Listing?.findById === "function") {
    const listing = await Listing.findById(listingId).select("images title").lean().exec().catch(() => null);
    if (!listing) return;

    const images = listing.images || [];
    if (images.length === 0) {
      await sendInteractiveButtons(phone, "No photos to delete.", [{ id: `manage_photos_${listingId}`, title: "🔙 Back" }], { headerText: "Delete Photos" });
      return;
    }

    // Only send images if starting fresh (no selection)
    if (selectedIndices.length === 0) {
      await sendText(phone, `📷 Loading ${images.length} photo(s) for "${listing.title}"...`);
      // Send images with captions
      for (let i = 0; i < images.length; i++) {
        await sendImage(phone, images[i], `Photo ${i + 1}`);
      }
    }

    // Build rows
    const rows = images.map((_, i) => {
      const isSelected = selectedIndices.includes(i);
      return {
        id: `toggle_photo_delete_${listingId}_${i}`,
        title: isSelected ? `✅ Photo ${i + 1} (Selected)` : `Photo ${i + 1}`,
        description: isSelected ? "Tap to unselect" : "Tap to select for deletion"
      };
    });

    // Add "Confirm Delete" option if any selected
    if (selectedIndices.length > 0) {
      rows.unshift({
        id: `confirm_delete_photos_${listingId}`,
        title: `🗑️ Delete (${selectedIndices.length})`,
        description: "Confirm deletion"
      });
    }

    // Add "Back" option
    rows.push({
      id: `manage_photos_${listingId}`,
      title: "🔙 Back to Menu",
      description: "Go back to photo management"
    });

    const headerText = selectedIndices.length > 0 ? `Delete Photos (${selectedIndices.length} selected)` : "Delete Photos";

    await sendInteractiveList(phone, "Select photos to delete below:", rows, {
      headerText: headerText,
      sectionTitle: "Options",
      buttonText: "Select"
    });
  }
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
// fallback ID restored from your earlier working
const DEFAULT_FLOW_ID = process.env.WHATSAPP_FLOW_ID || "1534021024566343";
const LIST_PROPERTY_FLOW_ID = process.env.WHATSAPP_LIST_FLOW_ID || "2038464217012262";
const RESIDENTIAL_SEARCH_FLOW_ID = process.env.WHATSAPP_FLOW_RESIDENTIAL_SEARCH || "3819352211531237";
const RENT_A_CHAIR_SEARCH_FLOW_ID = process.env.WHATSAPP_FLOW_RENT_A_CHAIR_SEARCH || "953208663822408";
const BOARDING_SEARCH_FLOW_ID = process.env.WHATSAPP_FLOW_BOARDING_SEARCH || "2368498460238432";
const SHOP_SEARCH_FLOW_ID = process.env.WHATSAPP_FLOW_SHOP_SEARCH || "1910668816993710";
const PREDEFINED_CITIES = [
  { id: "harare", title: "Harare" },
  { id: "chitungwiza", title: "Chitungwiza" },
  { id: "bulawayo", title: "Bulawayo" },
  { id: "mutare", title: "Mutare" },
  { id: "gweru", title: "Gweru" },
  { id: "masvingo", title: "Masvingo" },
  { id: "victoria_falls", title: "Victoria Falls" },
  { id: "norton", title: "Norton" },
];

const PREDEFINED_SUBURBS = [
  { id: "any", title: "Any" },
  { id: "borrowdale", title: "Borrowdale" },
  { id: "mount_pleasant", title: "Mount Pleasant" },
  { id: "avondale", title: "Avondale" },
  { id: "highlands", title: "Highlands" },
  { id: "belgravia", title: "Belgravia" },
  { id: "mabelreign", title: "Mabelreign" },
  { id: "eastlea", title: "Eastlea" },
  { id: "chisipite", title: "Chisipite" },
  { id: "glen_lorne", title: "Glen Lorne" },
  { id: "greendale", title: "Greendale" },
  { id: "gunhill", title: "Gunhill" },
  { id: "chitungwiza_central", title: "Chitungwiza Central" },
  { id: "zengeza", title: "Zengeza" },
  { id: "seke", title: "Seke" },
  { id: "st_marys", title: "St Mary's" },
  { id: "hillside", title: "Hillside (Bulawayo)" },
  { id: "entumbane", title: "Entumbane" },
  { id: "famona", title: "Famona" },
  { id: "burnside", title: "Burnside" },
  { id: "belmont_byo", title: "Belmont" },
  { id: "nkulumane", title: "Nkulumane" },
  { id: "dangamvura", title: "Dangamvura (Mutare)" },
  { id: "sakubva", title: "Sakubva" },
  { id: "morningside", title: "Morningside" },
  { id: "fern_valley", title: "Fern Valley" },
  { id: "mkoba", title: "Mkoba (Gweru)" },
  { id: "ascot", title: "Ascot (Gweru)" },
  { id: "mucheke", title: "Mucheke (Masvingo)" },
  { id: "victoria_falls_town", title: "Victoria Falls Town" },
  { id: "norton_town", title: "Norton Town" },
];

const PREDEFINED_PROPERTY_CATEGORIES = [
  { id: "residential", title: "Residential" },
  { id: "commercial", title: "Commercial" },
];

const PREDEFINED_PROPERTY_TYPES = [
  { id: "house", title: "House" },
  { id: "flat", title: "Flat" },
  { id: "studio", title: "Studio" },
  { id: "office", title: "Office" },
  { id: "retail", title: "Retail" },
];

const PREDEFINED_BEDROOMS = [
  { id: "any", title: "Any" },
  { id: "1", title: "1" },
  { id: "2", title: "2" },
  { id: "3", title: "3" },
  { id: "4", title: "4" },
  { id: "5plus", title: "5+" },
];

const PREDEFINED_FEATURES_OPTIONS = [
  { id: "borehole", title: "Borehole" },
  { id: "solar_backup", title: "Solar backup (inverter/UPS)" },
  { id: "solar_geyser", title: "Solar geyser / water heater" },
  { id: "internet", title: "Internet (fiber/Airtel/NetOne)" },
  { id: "fenced", title: "Fenced / secure" },
  { id: "garage", title: "Garage / covered parking" },
  { id: "garden", title: "Garden / yard" },
  { id: "furnished", title: "Furnished" },
  { id: "pets_allowed", title: "Pets allowed" },
  { id: "ac", title: "Air conditioning" },
];

const RESIDENTIAL_TOTAL_ROOMS = [
  { id: "any", title: "Any" },
  { id: "1", title: "1 Room" },
  { id: "2", title: "2 Rooms" },
  { id: "3", title: "3 Rooms" },
  { id: "4", title: "4 Rooms" },
  { id: "5", title: "5 Rooms" },
  { id: "6", title: "6 Rooms" },
  { id: "7plus", title: "7+ Rooms" },
];

const RESIDENTIAL_DEPOSIT_OPTIONS = [
  { id: "any", title: "Any Deposit" },
  { id: "no_deposit", title: "No Deposit Required" },
  { id: "half_month", title: "0.5 Month Deposit" },
  { id: "one_month", title: "1 Month Deposit" },
  { id: "two_months", title: "2 Months Deposit" },
  { id: "three_months", title: "3 Months Deposit" },
  { id: "custom", title: "Custom Deposit" },
];

const BOARDING_ROOM_TYPES = [
  { id: "any", title: "Any" },
  { id: "single_room", title: "Single Room" },
  { id: "shared_room", title: "Shared Room" },
  { id: "dormitory", title: "Dormitory" },
  { id: "ensuite_room", title: "En-suite Room" },
];

const BOARDING_OCCUPANCY_TYPES = [
  { id: "any", title: "Any" },
  { id: "1_person", title: "1 Person" },
  { id: "2_people", title: "2 People" },
  { id: "3_people", title: "3 People" },
  { id: "4plus_people", title: "4+ People" },
];

const BOARDING_GENDER_PREFERENCE = [
  { id: "any", title: "Any" },
  { id: "male_only", title: "Male Only" },
  { id: "female_only", title: "Female Only" },
  { id: "mixed", title: "Mixed" },
];

const BOARDING_DURATION = [
  { id: "any", title: "Any" },
  { id: "short_term", title: "Short Term (1-3 months)" },
  { id: "medium_term", title: "Medium Term (3-6 months)" },
  { id: "long_term", title: "Long Term (6+ months)" },
];

const BOARDING_FEATURES_OPTIONS = [
  { id: "meals_included", title: "Meals Included" },
  { id: "wifi_internet", title: "WiFi / Internet" },
  { id: "laundry_service", title: "Laundry Service" },
  { id: "shared_kitchen", title: "Shared Kitchen" },
  { id: "study_area", title: "Study Area" },
  { id: "common_room", title: "Common Room / Lounge" },
  { id: "parking", title: "Parking Available" },
  { id: "security", title: "24/7 Security" },
  { id: "cleaning_service", title: "Cleaning Service" },
  { id: "utilities_included", title: "Utilities Included" },
  { id: "near_transport", title: "Near Public Transport" },
  { id: "near_university", title: "Near University/College" },
];

const SHOP_SUBURBS = [
  { id: "any", title: "Any" },
  { id: "cbd_harare", title: "CBD (Harare)" },
  { id: "graniteside", title: "Graniteside" },
  { id: "msasa", title: "Msasa" },
  { id: "belvedere", title: "Belvedere" },
  { id: "southerton", title: "Southerton" },
];

const SHOP_TYPES = [
  { id: "any", title: "Any" },
  { id: "retail_shop", title: "Retail Shop" },
  { id: "boutique", title: "Boutique" },
  { id: "warehouse", title: "Warehouse" },
  { id: "office_space", title: "Office Space" },
  { id: "salon", title: "Salon" },
  { id: "kiosk", title: "Kiosk" },
  { id: "restaurant", title: "Restaurant" },
  { id: "workshop", title: "Workshop" },
];

const SHOP_LOCATION_TYPES = [
  { id: "any", title: "Any" },
  { id: "street_front", title: "Street front" },
  { id: "mall", title: "Mall / shopping center" },
  { id: "industrial", title: "Industrial area" },
  { id: "office_building", title: "Office building" },
];

const SHOP_SIZE_RANGES = [
  { id: "any", title: "Any" },
  { id: "small", title: "Small (0–20 sqm)" },
  { id: "medium", title: "Medium (20–60 sqm)" },
  { id: "large", title: "Large (60+ sqm)" },
];

const SHOP_BUSINESS_TYPES = [
  { id: "any", title: "Any" },
  { id: "retail", title: "Retail" },
  { id: "food", title: "Food / hospitality" },
  { id: "beauty", title: "Beauty / salon" },
  { id: "services", title: "Services" },
  { id: "storage", title: "Storage / warehouse" },
];

const SHOP_DEPOSIT_OPTIONS = [
  { id: "any", title: "Any" },
  { id: "0", title: "No deposit / negotiable" },
  { id: "1_month", title: "1 month deposit" },
  { id: "2_months", title: "2 months deposit" },
  { id: "3_months", title: "3 months deposit" },
];

const SHOP_FEATURES_OPTIONS = [
  { id: "any", title: "Any" },
  { id: "utilities_included", title: "Utilities included" },
  { id: "parking", title: "Parking" },
  { id: "security", title: "Security" },
  { id: "power_backup", title: "Power backup" },
  { id: "water_available", title: "Water available" },
  { id: "high_foot_traffic", title: "High foot traffic" },
  { id: "loading_access", title: "Loading access" },
];

const CHAIR_SERVICE_TYPES = [
  { id: "any", title: "Any" },
  { id: "barbering", title: "Barbering" },
  { id: "hair_styling", title: "Hair Styling" },
  { id: "nail_services", title: "Nail Services" },
  { id: "makeup", title: "Makeup Artistry" },
  { id: "massage", title: "Massage Therapy" },
  { id: "other", title: "Other Services" },
];

const CHAIR_FEATURES_OPTIONS = [
  { id: "any", title: "Any" },
  { id: "power", title: "Power available" },
  { id: "water", title: "Water available" },
  { id: "wifi", title: "WiFi" },
  { id: "parking", title: "Parking available" },
  { id: "security", title: "Security" },
  { id: "equipment", title: "Equipment included" },
];

const LIST_PROPERTY_SUBURBS = PREDEFINED_SUBURBS.filter((s) => s.id !== "any");
const LIST_PROPERTY_CATEGORIES = [
  { id: "residential", title: "Residential" },
  { id: "commercial", title: "Commercial" },
  { id: "boarding", title: "Boarding" },
  { id: "land", title: "Land" },
];
const LIST_PROPERTY_TYPES = [
  { id: "house", title: "House" },
  { id: "flat", title: "Flat" },
  { id: "cottage", title: "Cottage" },
  { id: "townhouse", title: "Townhouse" },
  { id: "room", title: "Room" },
  { id: "stand", title: "Stand" },
];
const LIST_PROPERTY_BEDROOMS = [
  { id: "0", title: "0 (no bedrooms / land/office)" },
  { id: "1", title: "1" },
  { id: "2", title: "2" },
  { id: "3", title: "3" },
  { id: "4plus", title: "4+" },
];

const LISTING_TYPES = [
  { id: "residential", title: "Residential Property" },
  { id: "commercial", title: "Shop/Commercial" },
  { id: "boarding", title: "Boarding House" },
  { id: "rent_a_chair", title: "Rent a Chair" },
];

const LISTING_PROPERTY_TYPES = [
  { id: "any", title: "Any" },
  { id: "house", title: "House" },
  { id: "flat", title: "Flat" },
  { id: "studio", title: "Studio" },
  { id: "cottage", title: "Cottage" },
];

const LISTING_SHOP_TYPES = [
  { id: "any", title: "Any" },
  { id: "retail_shop", title: "Retail Shop" },
  { id: "office_space", title: "Office Space" },
  { id: "warehouse", title: "Warehouse" },
  { id: "restaurant_space", title: "Restaurant Space" },
];

const LISTING_ROOM_TYPES = [
  { id: "any", title: "Any" },
  { id: "single_room", title: "Single Room" },
  { id: "shared_room", title: "Shared Room" },
  { id: "dormitory", title: "Dormitory" },
  { id: "ensuite_room", title: "En-suite Room" },
];

const LISTING_SERVICE_TYPES = [
  { id: "any", title: "Any" },
  { id: "barbering", title: "Barbering" },
  { id: "hair_styling", title: "Hair Styling" },
  { id: "nail_services", title: "Nail Services" },
  { id: "makeup_artistry", title: "Makeup Artistry" },
  { id: "massage_therapy", title: "Massage Therapy" },
  { id: "other_services", title: "Other Services" },
];

const LISTING_BEDROOMS = [
  { id: "any", title: "Any" },
  { id: "0", title: "0 (Studio/Office)" },
  { id: "1", title: "1" },
  { id: "2", title: "2" },
  { id: "3", title: "3" },
  { id: "4", title: "4" },
  { id: "5plus", title: "5+" },
];

const LISTING_OCCUPANCY_TYPES = [
  { id: "any", title: "Any" },
  { id: "1_person", title: "1 Person" },
  { id: "2_people", title: "2 People" },
  { id: "3_people", title: "3 People" },
  { id: "4plus_people", title: "4+ People" },
];

const LISTING_GENDER_PREFERENCE = [
  { id: "any", title: "Any" },
  { id: "male_only", title: "Male Only" },
  { id: "female_only", title: "Female Only" },
  { id: "mixed", title: "Mixed" },
];

const LISTING_DURATION = [
  { id: "any", title: "Any" },
  { id: "short_term", title: "Short Term (1-3 months)" },
  { id: "medium_term", title: "Medium Term (3-6 months)" },
  { id: "long_term", title: "Long Term (6+ months)" },
];

const LISTING_RESIDENTIAL_FEATURES = [
  { id: "borehole", title: "Borehole" },
  { id: "solar_backup", title: "Solar Backup" },
  { id: "solar_geyser", title: "Solar Geyser" },
  { id: "internet", title: "Internet" },
  { id: "fenced", title: "Fenced/Secure" },
  { id: "garage", title: "Garage" },
  { id: "garden", title: "Garden" },
  { id: "furnished", title: "Furnished" },
  { id: "pets_allowed", title: "Pets Allowed" },
  { id: "ac", title: "Air Conditioning" },
];

const LISTING_BOARDING_FEATURES = [
  { id: "meals_included", title: "Meals Included" },
  { id: "wifi_internet", title: "WiFi / Internet" },
  { id: "laundry_service", title: "Laundry Service" },
  { id: "shared_kitchen", title: "Shared Kitchen" },
  { id: "study_area", title: "Study Area" },
  { id: "common_room", title: "Common Room / Lounge" },
  { id: "parking", title: "Parking Available" },
  { id: "security", title: "24/7 Security" },
  { id: "cleaning_service", title: "Cleaning Service" },
  { id: "utilities_included", title: "Utilities Included" },
  { id: "near_transport", title: "Near Public Transport" },
  { id: "near_university", title: "Near University/College" },
];

const LISTING_COMMERCIAL_FEATURES = [
  { id: "high_foot_traffic", title: "High Foot Traffic" },
  { id: "parking_available", title: "Parking Available" },
  { id: "loading_bay", title: "Loading Bay/Dock" },
  { id: "air_conditioning", title: "Air Conditioning" },
  { id: "security_system", title: "Security System" },
  { id: "storage_space", title: "Storage Space" },
  { id: "backup_power", title: "Backup Power" },
];

const LISTING_CHAIR_FEATURES = [
  { id: "private_space", title: "Private Space" },
  { id: "shared_space", title: "Shared Space" },
  { id: "all_inclusive", title: "All Inclusive" },
  { id: "furnished", title: "Furnished" },
  { id: "parking_available", title: "Parking Available" },
  { id: "utilities_included", title: "Utilities Included" },
];

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

function toSlugId(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function toSuburbId(value) {
  const raw = String(value || "").trim();
  const first = raw.split(",")[0]?.trim() || raw;
  const slug = toSlugId(first);
  return slug || toSlugId(raw);
}

function resolveTitleById(id, options = []) {
  const raw = String(id || "").trim();
  if (!raw) return "";
  const match = Array.isArray(options) ? options.find((o) => o && o.id === raw) : null;
  return match ? String(match.title || "").trim() : raw;
}

function resolveIdByTitle(title, options = []) {
  const raw = String(title || "").trim().toLowerCase();
  if (!raw) return "";
  const match = Array.isArray(options) ? options.find((o) => String(o.title || "").trim().toLowerCase() === raw) : null;
  return match ? match.id : "";
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

async function sendFlowMessage(phoneNumber, data = {}) {
  const apiToken = process.env.WHATSAPP_API_TOKEN;
  const phone_number_id = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;
  const flowId = String(data.flowId || "").trim();
  const screen = String(data.screen || "").trim() || "SEARCH";
  const payloadData = data.payloadData && typeof data.payloadData === "object" ? data.payloadData : {};

  if (!flowId) {
    console.warn("[sendFlowMessage] no flowId configured.");
    return { error: "no-flow", reason: "no-flow-id" };
  }
  if (!apiToken || !phone_number_id) {
    console.warn("[sendFlowMessage] missing WHATSAPP_API_TOKEN or PHONE_NUMBER_ID");
    return { error: "no-flow", reason: "missing-credentials" };
  }

  const interactivePayload = {
    messaging_product: "whatsapp",
    to: digitsOnly(phoneNumber),
    type: "interactive",
    interactive: {
      type: "flow",
      header: { type: "text", text: data.headerText || "Form" },
      body: { text: data.bodyText || "Fill and submit the form." },
      footer: { text: data.footerText || "Continue" },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_id: flowId,
          flow_cta: data.flow_cta || "Continue",
          flow_action: "navigate",
          flow_action_payload: { screen, data: payloadData },
        },
      },
    },
  };

  console.log("[sendFlowMessage] will send flow to", digitsOnly(phoneNumber), "flow_id:", flowId, "screen:", screen);

  const hash = _hash(`flow:${flowId}:${screen}:${JSON.stringify(interactivePayload.interactive)}`);
  if (!_shouldSend(digitsOnly(phoneNumber), hash, TTL_INTERACTIVE_MS)) {
    console.log("[sendFlowMessage] suppressed duplicate flow send for", digitsOnly(phoneNumber));
    return { suppressed: true };
  }
  if (!(await _shouldSendDb(digitsOnly(phoneNumber), hash))) {
    console.log("[sendFlowMessage] suppressed duplicate flow send (db) for", digitsOnly(phoneNumber));
    return { suppressed: true };
  }

  const res = await whatsappPost(phone_number_id, apiToken, interactivePayload).catch((e) => {
    console.warn("[sendFlowMessage] whatsappPost error:", e);
    return { error: e };
  });

  const waid = res?.messages?.[0]?.id || null;
  if (!res?.error) {
    await _recordOutboundMessage({
      phone: digitsOnly(phoneNumber),
      wa_message_id: waid,
      type: "interactive",
      text: JSON.stringify(payloadData),
      raw: interactivePayload,
      meta: { hash, interactiveType: "flow", screen, flowId },
    });
  }

  console.log("[sendFlowMessage] send response:", res && (res.error ? JSON.stringify(res) : "ok"));
  return res;
}

async function sendResidentialSearchFlow(phoneNumber, data = {}) {
  const hasId = (list, id) => Array.isArray(list) && list.some((o) => o && o.id === id);

  const cities = PREDEFINED_CITIES;
  const suburbs = PREDEFINED_SUBURBS;
  const propertyCategories = PREDEFINED_PROPERTY_CATEGORIES;
  const propertyTypes = PREDEFINED_PROPERTY_TYPES;
  const bedrooms = PREDEFINED_BEDROOMS;
  const totalRooms = RESIDENTIAL_TOTAL_ROOMS;
  const depositOptions = RESIDENTIAL_DEPOSIT_OPTIONS;
  const featuresOptions = PREDEFINED_FEATURES_OPTIONS;

  const selected_city = hasId(cities, String(data.selected_city || "harare")) ? String(data.selected_city || "harare") : (cities[0]?.id || "harare");
  const selected_suburb = hasId(suburbs, String(data.selected_suburb || "any")) ? String(data.selected_suburb || "any") : "any";
  const selected_category = "residential";
  const selected_type = hasId(propertyTypes, String(data.selected_type || "house")) ? String(data.selected_type || "house") : (propertyTypes[0]?.id || "house");
  const selected_bedrooms = hasId(bedrooms, String(data.selected_bedrooms || "any")) ? String(data.selected_bedrooms || "any") : "any";
  const selected_total_rooms = hasId(totalRooms, String(data.selected_total_rooms || "any")) ? String(data.selected_total_rooms || "any") : "any";
  const selected_deposit = hasId(depositOptions, String(data.selected_deposit || "any")) ? String(data.selected_deposit || "any") : "any";
  const selected_features = Array.isArray(data.selected_features) ? data.selected_features : [];

  const payloadData = {
    cities,
    suburbs,
    propertyCategories,
    propertyTypes,
    bedrooms,
    totalRooms,
    depositOptions,
    featuresOptions,
    min_price: typeof data.min_price === "string" ? data.min_price : "0",
    max_price: typeof data.max_price === "string" ? data.max_price : "10000000",
    q: typeof data.q === "string" ? data.q : "",
    selected_city,
    selected_suburb,
    selected_category,
    selected_type,
    selected_bedrooms,
    selected_total_rooms,
    selected_deposit,
    selected_features,
  };

  return sendFlowMessage(phoneNumber, {
    flowId: RESIDENTIAL_SEARCH_FLOW_ID,
    screen: "SEARCH",
    payloadData,
    headerText: "🏠 Find Rentals",
    bodyText: "Fill in the details below to find your perfect home.\n\nInstructions: Select your preferences and tap Search.",
    footerText: "Start Search",
    flow_cta: "🔎 Search",
  });
}

async function sendBoardingSearchFlow(phoneNumber, data = {}) {
  const hasId = (list, id) => Array.isArray(list) && list.some((o) => o && o.id === id);

  const cities = PREDEFINED_CITIES;
  const suburbs = PREDEFINED_SUBURBS;
  const roomTypes = BOARDING_ROOM_TYPES;
  const occupancyTypes = BOARDING_OCCUPANCY_TYPES;
  const genderPreference = BOARDING_GENDER_PREFERENCE;
  const duration = BOARDING_DURATION;
  const featuresOptions = BOARDING_FEATURES_OPTIONS;

  const selected_city = hasId(cities, String(data.selected_city || "harare")) ? String(data.selected_city || "harare") : (cities[0]?.id || "harare");
  const selected_suburb = hasId(suburbs, String(data.selected_suburb || "any")) ? String(data.selected_suburb || "any") : "any";
  const selected_room_type = hasId(roomTypes, String(data.selected_room_type || "any")) ? String(data.selected_room_type || "any") : "any";
  const selected_occupancy = hasId(occupancyTypes, String(data.selected_occupancy || "any")) ? String(data.selected_occupancy || "any") : "any";
  const selected_gender_preference = hasId(genderPreference, String(data.selected_gender_preference || "any")) ? String(data.selected_gender_preference || "any") : "any";
  const selected_duration = hasId(duration, String(data.selected_duration || "any")) ? String(data.selected_duration || "any") : "any";
  const selected_features = Array.isArray(data.selected_features) ? data.selected_features : [];

  const payloadData = {
    cities,
    suburbs,
    roomTypes,
    occupancyTypes,
    genderPreference,
    duration,
    featuresOptions,
    min_price: typeof data.min_price === "string" ? data.min_price : "0",
    max_price: typeof data.max_price === "string" ? data.max_price : "10000000",
    q: typeof data.q === "string" ? data.q : "",
    selected_city,
    selected_suburb,
    selected_room_type,
    selected_occupancy,
    selected_gender_preference,
    selected_duration,
    selected_features,
    number_of_students: typeof data.number_of_students === "string" ? data.number_of_students : "0",
    deposit_amount: typeof data.deposit_amount === "string" ? data.deposit_amount : "0",
  };

  return sendFlowMessage(phoneNumber, {
    flowId: BOARDING_SEARCH_FLOW_ID,
    screen: "BOARDING_SEARCH",
    payloadData,
    headerText: "🛏️ Find Boarding House",
    bodyText: "Looking for student or shared accommodation?\n\nInstructions: Select your preferences and tap Search.",
    footerText: "Start Search",
    flow_cta: "🔎 Search",
  });
}

async function sendShopSearchFlow(phoneNumber, data = {}) {
  const hasId = (list, id) => Array.isArray(list) && list.some((o) => o && o.id === id);

  const cities = PREDEFINED_CITIES;
  const suburbs = SHOP_SUBURBS;
  const shopTypes = SHOP_TYPES;
  const locationTypes = SHOP_LOCATION_TYPES;
  const sizeRanges = SHOP_SIZE_RANGES;
  const businessTypes = SHOP_BUSINESS_TYPES;
  const depositOptions = SHOP_DEPOSIT_OPTIONS;
  const featuresOptions = SHOP_FEATURES_OPTIONS;

  const selected_city = hasId(cities, String(data.selected_city || "harare")) ? String(data.selected_city || "harare") : (cities[0]?.id || "harare");
  const selected_suburb = hasId(suburbs, String(data.selected_suburb || "any")) ? String(data.selected_suburb || "any") : "any";
  const selected_shop_type = hasId(shopTypes, String(data.selected_shop_type || "any")) ? String(data.selected_shop_type || "any") : "any";
  const selected_location_type = hasId(locationTypes, String(data.selected_location_type || "any")) ? String(data.selected_location_type || "any") : "any";
  const selected_size_range = hasId(sizeRanges, String(data.selected_size_range || "any")) ? String(data.selected_size_range || "any") : "any";
  const selected_business_type = hasId(businessTypes, String(data.selected_business_type || "any")) ? String(data.selected_business_type || "any") : "any";
  const selected_deposit = hasId(depositOptions, String(data.selected_deposit || "any")) ? String(data.selected_deposit || "any") : "any";
  const selected_features = Array.isArray(data.selected_features) ? data.selected_features : [];

  const payloadData = {
    cities,
    suburbs,
    shopTypes,
    locationTypes,
    sizeRanges,
    businessTypes,
    depositOptions,
    featuresOptions,
    min_price: typeof data.min_price === "string" ? data.min_price : "0",
    max_price: typeof data.max_price === "string" ? data.max_price : "10000000",
    q: typeof data.q === "string" ? data.q : "",
    selected_city,
    selected_suburb,
    selected_shop_type,
    selected_location_type,
    selected_size_range,
    selected_business_type,
    selected_deposit,
    selected_features,
    deposit_amount: typeof data.deposit_amount === "string" ? data.deposit_amount : "0",
  };

  return sendFlowMessage(phoneNumber, {
    flowId: SHOP_SEARCH_FLOW_ID,
    screen: "SHOP_SEARCH",
    payloadData,
    headerText: "🏪 Find Commercial/Shop",
    bodyText: "Searching for retail or office space?\n\nInstructions: Select your preferences and tap Search.",
    footerText: "Start Search",
    flow_cta: "🔎 Search",
  });
}

async function sendRentAChairSearchFlow(phoneNumber, data = {}) {
  const hasId = (list, id) => Array.isArray(list) && list.some((o) => o && o.id === id);

  const cities = PREDEFINED_CITIES;
  const suburbs = PREDEFINED_SUBURBS;
  const serviceTypes = CHAIR_SERVICE_TYPES;
  const featuresOptions = CHAIR_FEATURES_OPTIONS;

  const selected_city = hasId(cities, String(data.selected_city || "harare")) ? String(data.selected_city || "harare") : (cities[0]?.id || "harare");
  const selected_suburb = hasId(suburbs, String(data.selected_suburb || "any")) ? String(data.selected_suburb || "any") : "any";
  const selected_service_type = hasId(serviceTypes, String(data.selected_service_type || "any")) ? String(data.selected_service_type || "any") : "any";
  const selected_features = Array.isArray(data.selected_features) ? data.selected_features : [];

  const payloadData = {
    cities,
    suburbs,
    serviceTypes,
    featuresOptions,
    min_price: typeof data.min_price === "string" ? data.min_price : "0",
    max_price: typeof data.max_price === "string" ? data.max_price : "10000000",
    q: typeof data.q === "string" ? data.q : "",
    selected_city,
    selected_suburb,
    selected_service_type,
    selected_features,
  };

  return sendFlowMessage(phoneNumber, {
    flowId: RENT_A_CHAIR_SEARCH_FLOW_ID,
    screen: "RENT_A_CHAIR_SEARCH",
    payloadData,
    headerText: "💇 Find Rent a Chair",
    bodyText: "Looking for a salon or barber station?\n\nInstructions: Select your preferences and tap Search.",
    footerText: "Start Search",
    flow_cta: "🔎 Search",
  });
}

async function sendListPropertyFlow(phoneNumber, data = {}) {
  if (!LIST_PROPERTY_FLOW_ID) {
    console.warn("[sendListPropertyFlow] no LIST_PROPERTY_FLOW_ID configured.");
    return { error: "no-flow", reason: "no-list-flow-id" };
  }
  const payloadData = {
    listingTypes: LISTING_TYPES,
    cities: PREDEFINED_CITIES,
    suburbs: PREDEFINED_SUBURBS,
    propertyTypes: LISTING_PROPERTY_TYPES,
    shopTypes: LISTING_SHOP_TYPES,
    roomTypes: LISTING_ROOM_TYPES,
    serviceTypes: LISTING_SERVICE_TYPES,
    bedrooms: LISTING_BEDROOMS,
    occupancyTypes: LISTING_OCCUPANCY_TYPES,
    genderPreference: LISTING_GENDER_PREFERENCE,
    duration: LISTING_DURATION,
    residentialFeatures: LISTING_RESIDENTIAL_FEATURES,
    boardingFeatures: LISTING_BOARDING_FEATURES,
    commercialFeatures: LISTING_COMMERCIAL_FEATURES,
    chairFeatures: LISTING_CHAIR_FEATURES,
    listing_type: "",
    title: "",
    lister_phone_number: "",
    contact_name: "",
    contact_phone: "",
    contact_whatsapp: "",
    contact_email: "",
    selected_city: "harare",
    selected_suburb: "any",
    selected_property_type: "any",
    selected_shop_type: "any",
    selected_room_type: "any",
    selected_service_type: "any",
    selected_bedrooms: "any",
    selected_occupancy: "any",
    selected_gender: "any",
    selected_duration: "any",
    number_of_students: "1",
    price_per_month: "",
    deposit_amount: "",
    description: "",
    selected_residential_features: [],
    selected_boarding_features: [],
    selected_commercial_features: [],
    selected_chair_features: [],
    ...data.payloadOverrides,
  };

  return sendFlowMessage(phoneNumber, {
    flowId: String(LIST_PROPERTY_FLOW_ID),
    screen: "LIST_PROPERTY",
    payloadData,
    headerText: data.headerText || "📝 List a Property",
    bodyText: (data.bodyText || "Ready to find a tenant/buyer? Fill out the details below.") + "\n\nInstructions: Fill and submit to publish.",
    footerText: "Open Listing Form",
    flow_cta: data.flow_cta || "📝 Create Listing",
  });
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
      header: { type: "text", text: resultsPayload.headerText || "🔍 Search Results" },
      body: { text: resultsPayload.bodyText || (resultsPayload.data && resultsPayload.data.listingText0) || "Results found:" },
      footer: { text: resultsPayload.footerText || "View Results" },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_id: String(DEFAULT_FLOW_ID),
          flow_cta: resultsPayload.flow_cta || "👁️ View Results",
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
  if (!(await _shouldSendDb(phone, hash))) {
    console.log("[sendResultsFlow] suppressed duplicate results flow (db) for", phone);
    return { suppressed: true };
  }

  const res = await whatsappPost(phone_number_id, apiToken, interactivePayload);
  const waid = res?.messages?.[0]?.id || null;
  if (!res?.error) {
    await _recordOutboundMessage({
      phone,
      wa_message_id: waid,
      type: "interactive",
      text: JSON.stringify(resultsPayload?.data || {}),
      raw: interactivePayload,
      meta: { hash, interactiveType: "flow", screen: resultsPayload.screen || "RESULTS", flowId: String(DEFAULT_FLOW_ID) },
    });
  }
  return res;
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

function getShortIdFromListing(l) {
  const raw = typeof l?.shortId === "string" ? l.shortId.trim().toUpperCase() : "";
  return /^[A-Z0-9]{4}$/.test(raw) ? raw : "";
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

  const shortId = getShortIdFromListing(ensured);
  const title = String(ensured.title || "Listing").trim();
  const suburb = String(ensured.suburb || "").trim();
  const price = ensured.pricePerMonth ?? ensured.price ?? "N/A";

  const description = ensured.description ? String(ensured.description).replace(/\s+/g, " ").trim() : "";
  const descriptionShort = description ? description.slice(0, 220) : "";

  const features = Array.isArray(ensured.features)
    ? ensured.features.map((f) => String(f || "").trim()).filter(Boolean)
    : [];

  const featuresShort = features.slice(0, 6);

  const lines = [
    `${indexHint + 1}) 🏠 ${title} — 📍 ${suburb} — 💰 $${price}`,
    shortId ? `🏷️ CODE: ${shortId}` : null,
    `🆔 ID: ${id}`,
  ].filter(Boolean);

  // Picture available status
  const photos = (ensured.images || ensured.photos || ensured.photosUrls || []);
  if (photos.length > 0) {
    lines.push(`🖼️ Picture available (${photos.length})`);
  } else {
    lines.push("🚫 No pictures available");
  }

  // Deposit info
  const deposit = ensured.deposit ?? ensured.securityDeposit;
  if (deposit === 0 || deposit === "0" || !deposit) {
    lines.push("🆓 No deposit required");
  } else {
    lines.push(`💵 Deposit: $${deposit}`);
  }

  if (descriptionShort) {
    lines.push("", "📝 Description:", ` ${descriptionShort}`);
  }

  if (featuresShort.length) {
    lines.push("", "✨ Features:", featuresShort.map((f) => ` • ${f}`).join("\n"));
  }

  return lines.join("\n");
}

/* -------------------------
   Flow detection & parsing helpers
------------------------- */
function detectRequestedScreen(rawPayload = {}) {
  const v = rawPayload?.entry?.[0]?.changes?.[0]?.value || rawPayload || {};
  const interactiveType = _safeGet(v, ["messages", 0, "interactive", "type"]);
  if (interactiveType === "nfm_reply") {
    const d = getFlowDataFromPayload(rawPayload) || {};
    const keys = d && typeof d === "object" ? Object.keys(d) : [];
    if (
      keys.includes("title") ||
      keys.includes("listerPhoneNumber") ||
      keys.includes("pricePerMonth") ||
      keys.includes("propertyCategory") ||
      keys.includes("propertyType") ||
      keys.includes("imageUrls") ||
      keys.includes("listing_type") ||
      keys.includes("lister_phone_number") ||
      keys.includes("price_per_month")
    ) {
      return "LIST_PROPERTY";
    }
    if (keys.includes("room_type") || keys.includes("occupancy") || keys.includes("gender_preference") || keys.includes("duration")) {
      return "BOARDING_SEARCH";
    }
    if (keys.includes("shop_type") || keys.includes("location_type") || keys.includes("size_range") || keys.includes("business_type")) {
      return "SHOP_SEARCH";
    }
    if (keys.includes("service_type")) {
      return "RENT_A_CHAIR_SEARCH";
    }
    return "SEARCH";
  }
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
      if (keys.includes("title") || keys.includes("listerPhoneNumber") || keys.includes("pricePerMonth") || keys.includes("listing_type") || keys.includes("lister_phone_number") || keys.includes("price_per_month")) return "LIST_PROPERTY";
      if (keys.includes("room_type") || keys.includes("occupancy") || keys.includes("gender_preference") || keys.includes("duration")) return "BOARDING_SEARCH";
      if (keys.includes("shop_type") || keys.includes("location_type") || keys.includes("size_range") || keys.includes("business_type")) return "SHOP_SEARCH";
      if (keys.includes("service_type")) return "RENT_A_CHAIR_SEARCH";
      if (keys.includes("city") || keys.includes("selected_city") || keys.includes("q") || keys.includes("min_price")) return "SEARCH";
    }
  }

  const flowData = getFlowDataFromPayload(rawPayload);
  if (flowData && (flowData.title || flowData.listerPhoneNumber || flowData.pricePerMonth || flowData.listing_type || flowData.lister_phone_number || flowData.price_per_month)) return "LIST_PROPERTY";
  if (flowData && (flowData.room_type || flowData.occupancy || flowData.gender_preference || flowData.duration)) return "BOARDING_SEARCH";
  if (flowData && (flowData.shop_type || flowData.location_type || flowData.size_range || flowData.business_type)) return "SHOP_SEARCH";
  if (flowData && flowData.service_type) return "RENT_A_CHAIR_SEARCH";
  if (flowData && (flowData.q || flowData.city || flowData.suburb || flowData.min_price || flowData.max_price)) return "SEARCH";
  return null;
}

function getFlowDataFromPayload(payload) {
  try {
    const v = payload?.entry?.[0]?.changes?.[0]?.value || payload || {};
    const nfmJson = _safeGet(v, ["messages", 0, "interactive", "nfm_reply", "response_json"]);
    if (nfmJson && typeof nfmJson === "string") {
      try {
        const parsed = JSON.parse(nfmJson);
        if (parsed && typeof parsed === "object") {
          const maybeData = parsed.data;
          if (maybeData && typeof maybeData === "object" && Object.keys(parsed).length <= 4) {
            return { ...maybeData, screen: parsed.screen || maybeData.screen || undefined };
          }
          return parsed;
        }
        return {};
      } catch (e) { /* ignore */ }
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
      out.features = maybe("features") ?? maybe("selected_features");
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
  const rows = [
    { id: "menu_search", title: "🔍 Search properties", description: "Find a place to rent/buy" },
    { id: "menu_list", title: "📝 List a property", description: "Add a new listing" },
    { id: "menu_edit_listings", title: "✏️ Edit my listings", description: "Manage your listings" },
    { id: "menu_purchases", title: "🛍️ View past purchases", description: "See properties you viewed" },
    { id: "menu_contacts", title: "💬 View past messages", description: "See contact details revealed" },
    { id: "menu_report", title: "⚠️ Report listing", description: "Report an issue" }
  ];

  await sendInteractiveList(phone, "👋 Welcome to CribMatch — please choose an option:", rows, {
    headerText: "🏠 Main Menu",
    buttonText: "Menu",
    sectionTitle: "Options"
  });
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
    // 1. Fast memory check
    if (isSeenInMemory(msgId)) {
      console.log("[webhook] Duplicate (Memory):", msgId);
      return NextResponse.json({ ok: true, note: "duplicate-event-mem" });
    }

    // 2. Atomic DB check-and-set
    if (dbAvailable && msgId) {
      // Attempt to set handled=true.
      // If document exists, we get the OLD version (new: false).
      // If it didn't exist, we create it with handled=true.
      const prev = await Message.findOneAndUpdate(
        { wa_message_id: msgId },
        { $set: { "meta.handled": true, lastSeenAt: new Date() } },
        { upsert: true, new: false, setDefaultsOnInsert: true }
      ).select("meta.handled").lean().exec().catch(() => null);

      // If previous version existed AND was already handled, it's a duplicate.
      if (prev && prev.meta?.handled) {
        console.log("[webhook] Duplicate (DB):", msgId);
        markSeenInMemory(msgId);
        return NextResponse.json({ ok: true, note: "duplicate-event-db" });
      }
    }
    markSeenInMemory(msgId);
  } catch (e) { console.warn("[webhook] dedupe error", e); }

  // persist incoming message as Message (best-effort)
  let savedMsg = null;
  try {
    if (dbAvailable && typeof Message?.findOneAndUpdate === "function") {
      const doc = {
        phone,
        from: "user",
        wa_message_id: msgId || null,
        type: parsedText ? "text" : "interactive",
        text: parsedText || "",
        raw: payload,
        meta: { direction: "inbound", handled: true },
      };
      // Upsert with $set to ensure content is saved even if document exists (from dedupe)
      savedMsg = await Message.findOneAndUpdate(
        { wa_message_id: msgId },
        { $set: doc },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).exec();
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
     Handle Image Uploads (AWAITING_PHOTOS_EDIT)
  ------------------------- */
  if (msg?.type === "image" && lastMeta?.state === "AWAITING_PHOTOS_EDIT") {
    const listingId = lastMeta.listingId;
    const imageId = msg.image?.id;

    if (listingId && imageId) {
      fetchAndAddImageToListing(listingId, imageId, process.env.WHATSAPP_API_TOKEN).catch(err => console.error("Async image fetch error", err));
      return NextResponse.json({ ok: true, note: "image-uploaded-edit" });
    }
  }

  if ((cmd === "done" || cmd === "done_photos_edit") && lastMeta?.state === "AWAITING_PHOTOS_EDIT") {
    const listingId = lastMeta.listingId;
    await sendInteractiveButtons(phone, "Photos updated.", [{ id: `manage_photos_${listingId}`, title: "Back to Photos" }, { id: "menu_main", title: "Main Menu" }], { headerText: "Done" });
    if (savedMsg && savedMsg._id) {
      // Clear state by setting it to IDLE so we don't fall back to previous state
      await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.state": "IDLE" } }).catch(() => null);
    }
    return NextResponse.json({ ok: true, note: "listing-photos-edit-done" });
  }

  /* -------------------------
     Handle Image Uploads (AWAITING_PHOTOS)
  ------------------------- */
  if (msg?.type === "image" && lastMeta?.state === "AWAITING_PHOTOS") {
    const listingId = lastMeta.listingId;
    const currentCount = lastMeta.photoCount || 0;
    const imageId = msg.image?.id;

    if (listingId && imageId) {
      // Fire and forget image fetch/add
      fetchAndAddImageToListing(listingId, imageId, process.env.WHATSAPP_API_TOKEN).catch(err => console.error("Async image fetch error", err));

      const newCount = currentCount + 1;
      if (savedMsg && savedMsg._id) {
        await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.photoCount": newCount } }).catch(() => null);
      }

      if (newCount >= 5) {
        await sendTextWithInstructionHeader(phone, "That's 5 photos. Almost done! Please enter the address for this listing (e.g. 123 Samora Machel Ave).", "Type the address.");
        await sendButtonsWithInstructionHeader(phone, "Or return to main menu:", [{ id: "menu_main", title: "Main Menu" }], "Tap Main menu.");
        if (savedMsg && savedMsg._id) {
          await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.state": "AWAITING_ADDRESS", "meta.listingId": listingId } }).catch(() => null);
        }
      }
      return NextResponse.json({ ok: true, note: "image-uploaded" });
    }
  }

  if ((cmd === "done" || cmd === "done_photos_new" || cmd === "done_photos_catchall") && lastMeta?.state === "AWAITING_PHOTOS") {
    await sendTextWithInstructionHeader(phone, "Photos saved. Please enter the address for this listing (e.g. 123 Samora Machel Ave).", "Type the address.");
    await sendButtonsWithInstructionHeader(phone, "Or return to main menu:", [{ id: "menu_main", title: "Main Menu" }], "Tap Main menu.");
    if (savedMsg && savedMsg._id) {
      await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.state": "AWAITING_ADDRESS", "meta.listingId": lastMeta.listingId } }).catch(() => null);
    }
    return NextResponse.json({ ok: true, note: "listing-photos-done-awaiting-address" });
  }

  /* -------------------------
     Catch-all for AWAITING_PHOTOS (prevent menu interruption)
  ------------------------- */
  if (lastMeta?.state === "AWAITING_PHOTOS" || lastMeta?.state === "AWAITING_PHOTOS_EDIT") {
    // If user types 'menu', clear state and fall through to global menu handler
    if (cmd === "menu" || cmd === "main menu" || cmd === "menu_main") {
      if (savedMsg && savedMsg._id) {
        await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.state": "IDLE" } }).catch(() => null);
      }
      // Fall through to allow menu to process
    } else {
      // We already handled valid images and "done" command above.
      // If we are here, it's unhandled input while expecting photos.
      if (msg?.type === "image") {
        // Suppress menu for unhandled images (e.g. missing listingId or duplicates)
        return NextResponse.json({ ok: true, note: "image-upload-fallback-suppressed" });
      }
      await sendInteractiveButtons(
        phone,
        "📷 Please send photos one by one. Tap 'Done' when finished.",
        [{ id: "menu_main", title: "Main Menu" }, { id: "done_photos_catchall", title: "Done" }],
        { headerText: "Photos" }
      );
      return NextResponse.json({ ok: true, note: "awaiting-photos-catchall" });
    }
  }

  /* -------------------------
     Handle Search by Code (AWAITING_SEARCH_CODE)
  ------------------------- */
  if (lastMeta?.state === "AWAITING_SEARCH_CODE" && parsedText && !msg?.type?.includes("interactive")) {
    const code = parsedText.trim().toUpperCase();

    // Clear state
    if (savedMsg && savedMsg._id) {
      await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.state": "IDLE" } }).catch(() => null);
    }

    if (code.length < 3) {
      await sendWithMainMenuButton(phone, "⚠️ Code is too short.", "Please try searching again.");
      return NextResponse.json({ ok: true, note: "code-too-short" });
    }

    const listing = await getListingByShortId(code);
    if (!listing) {
      await sendWithMainMenuButton(phone, `❌ No listing found for code "${code}".`, "Please check the code and try again.");
      return NextResponse.json({ ok: true, note: "code-not-found" });
    }

    // Found! Show details
    await revealFromObject(listing, phone);
    await recordPurchase(phone, listing, dbAvailable);
    return NextResponse.json({ ok: true, note: "code-found-revealed" });
  }

  /* -------------------------
     Handle Address Entry (AWAITING_ADDRESS)
  ------------------------- */
  if (lastMeta?.state === "AWAITING_ADDRESS" && parsedText && !msg?.type?.includes("interactive")) {
    const cmdLower = String(parsedText).trim().toLowerCase();

    // If user types 'menu', clear state and fall through to global menu handler
    if (cmdLower === "menu" || cmdLower === "main menu") {
      if (savedMsg && savedMsg._id) {
        await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.state": "IDLE" } }).catch(() => null);
      }
      // Fall through...
    } else {
      const listingId = lastMeta.listingId;
      const address = String(parsedText).trim();

      if (listingId && address) {
        if (mongoose.connection.readyState === 1 && typeof Listing?.findByIdAndUpdate === "function") {
          await Listing.findByIdAndUpdate(listingId, { $set: { address: address } }).catch(() => null);
        }

        await sendTextWithInstructionHeader(phone, "🎉 Listing complete! Your property is now live.", "Tap Main menu.");
        if (savedMsg && savedMsg._id) {
          await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.state": "IDLE" } }).catch(() => null);
        }
        await sendMainMenu(phone);
        return NextResponse.json({ ok: true, note: "listing-address-done" });
      }
    }
  }

  /* -------------------------
     Catch-all for AWAITING_ADDRESS (e.g. image sent instead of text)
  ------------------------- */
  if (lastMeta?.state === "AWAITING_ADDRESS" && (!parsedText || msg?.type === "image")) {
    await sendInteractiveButtons(
      phone,
      "✅ Photos received. Please type the property address to finish.",
      [{ id: "menu_main", title: "Main Menu" }],
      { headerText: "Address" }
    );
    return NextResponse.json({ ok: true, note: "awaiting-address-fallback" });
  }

  /* -------------------------
     Flow response handling (Search)
  ------------------------- */
  const flowData = getFlowDataFromPayload(payload);
  const screen = detectRequestedScreen(payload);

  if (payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.interactive?.type === "nfm_reply") {
    console.log("[webhook] nfm_reply received:", JSON.stringify({ screen, flowData }, null, 2));
  }

  if (
    screen === "LIST_PROPERTY" ||
    (flowData && (flowData.listing_type || flowData.lister_phone_number || flowData.price_per_month))
  ) {
    try {
      const cityId = String(flowData.city || flowData.selected_city || "").trim();
      const suburbId = String(flowData.suburb || flowData.selected_suburb || "").trim();
      const listingTypeId = String(flowData.listing_type || "").trim();
      const propertyTypeId = String(flowData.property_type || "").trim();
      const shopTypeId = String(flowData.shop_type || "").trim();
      const roomTypeId = String(flowData.room_type || "").trim();
      const serviceTypeId = String(flowData.service_type || "").trim();
      const bedroomsId = String(flowData.bedrooms || "").trim();

      const cityTitle = resolveTitleById(cityId, PREDEFINED_CITIES);
      const suburbTitle = resolveTitleById(suburbId, PREDEFINED_SUBURBS);
      const listingTypeTitle = resolveTitleById(listingTypeId, LISTING_TYPES);
      const propertyTypeTitle = resolveTitleById(propertyTypeId, LISTING_PROPERTY_TYPES);
      const shopTypeTitle = resolveTitleById(shopTypeId, LISTING_SHOP_TYPES);
      const roomTypeTitle = resolveTitleById(roomTypeId, LISTING_ROOM_TYPES);
      const serviceTypeTitle = resolveTitleById(serviceTypeId, LISTING_SERVICE_TYPES);

      const title = String(flowData.title || "").trim();
      // Force use of sender's WhatsApp number as lister phone, ignoring form input
      const listerPhoneNumber = digitsOnly(phone);
      const contactName = String(flowData.contact_name || "").trim();
      const contactPhone = String(flowData.contact_phone || "").trim();
      const contactWhatsApp = String(flowData.contact_whatsapp || "").trim();
      const contactEmail = String(flowData.contact_email || "").trim();

      const priceRaw = String(flowData.price_per_month || "").trim();
      const depositRaw = String(flowData.deposit_amount || "").trim();
      const description = String(flowData.description || "").trim();

      const extractNumber = (value) => {
        const raw = String(value || "").replace(/,/g, " ").trim();
        const m = raw.match(/(\d+(?:\.\d+)?)/);
        if (!m) return null;
        const n = Number(m[1]);
        return Number.isFinite(n) ? n : null;
      };

      const pricePerMonth = extractNumber(priceRaw);
      const deposit = depositRaw ? extractNumber(depositRaw) : null;

      const bedrooms = bedroomsId === "5plus" ? 5 : Number(bedroomsId || "0");
      const bedroomsSafe = Number.isFinite(bedrooms) ? bedrooms : 0;

      const listingTypeNormalized =
        listingTypeId === "residential" || listingTypeId === "commercial" || listingTypeId === "boarding" || listingTypeId === "rent_a_chair"
          ? listingTypeId
          : "";

      const propertyTypeByListingType = (() => {
        if (listingTypeNormalized === "residential") return propertyTypeTitle && propertyTypeId !== "any" ? propertyTypeTitle : "Residential Property";
        if (listingTypeNormalized === "commercial") return shopTypeTitle && shopTypeId !== "any" ? shopTypeTitle : "Shop/Commercial";
        if (listingTypeNormalized === "boarding") return roomTypeTitle && roomTypeId !== "any" ? roomTypeTitle : "Boarding House";
        if (listingTypeNormalized === "rent_a_chair") return serviceTypeTitle && serviceTypeId !== "any" ? serviceTypeTitle : "Rent a Chair";
        return "";
      })();

      const featureTitles = (() => {
        if (listingTypeNormalized === "residential") {
          const ids = Array.isArray(flowData.residential_features) ? flowData.residential_features : [];
          return ids.map((fid) => resolveTitleById(fid, LISTING_RESIDENTIAL_FEATURES));
        }
        if (listingTypeNormalized === "boarding") {
          const ids = Array.isArray(flowData.boarding_features) ? flowData.boarding_features : [];
          return ids.map((fid) => resolveTitleById(fid, LISTING_BOARDING_FEATURES));
        }
        if (listingTypeNormalized === "commercial") {
          const ids = Array.isArray(flowData.commercial_features) ? flowData.commercial_features : [];
          return ids.map((fid) => resolveTitleById(fid, LISTING_COMMERCIAL_FEATURES));
        }
        if (listingTypeNormalized === "rent_a_chair") {
          const ids = Array.isArray(flowData.chair_features) ? flowData.chair_features : [];
          return ids.map((fid) => resolveTitleById(fid, LISTING_CHAIR_FEATURES));
        }
        return [];
      })();

      const features = featureTitles
        .map((v) => String(v || "").trim())
        .filter(Boolean)
        .slice(0, 20);

      const images = [];

      if (!title || !listerPhoneNumber || !listingTypeNormalized || !cityId || !suburbId || !propertyTypeByListingType || pricePerMonth === null) {
        await sendWithMainMenuButton(phone, "⚠️ Some required fields are missing. Please open the listing form again and submit.", "Tap Main menu, then List a property.");
        return NextResponse.json({ ok: true, note: "list-flow-missing-required" });
      }

      if (!dbAvailable || !process.env.MONGODB_URI || typeof Listing?.create !== "function") {
        await sendWithMainMenuButton(phone, "⚠️ Listing received, but publishing is not available (database not configured).", "Tap Main menu.");
        return NextResponse.json({ ok: true, note: "list-flow-no-db" });
      }

      const suburb = `${suburbTitle}${cityTitle ? `, ${cityTitle}` : ""}`.trim();

      const baseDoc = {
        title,
        listerPhoneNumber,
        suburb,
        propertyCategory: listingTypeNormalized,
        propertyType: propertyTypeByListingType,
        pricePerMonth,
        deposit: deposit && Number.isFinite(deposit) ? deposit : null,
        bedrooms: bedroomsSafe,
        description,
        features,
        contactName,
        contactPhone,
        contactWhatsApp,
        contactEmail,
        occupancy: String(flowData.occupancy || "").trim(),
        genderPreference: String(flowData.gender_preference || "").trim(),
        duration: String(flowData.duration || "").trim(),
        numberOfStudents: extractNumber(flowData.number_of_students),
        status: "published",
      };

      const editingListingId = lastMeta?.editingListingId;
      let created = null;

      if (editingListingId) {
        if (mongoose.connection.readyState === 1 && typeof Listing?.findByIdAndUpdate === "function") {
          created = await Listing.findByIdAndUpdate(editingListingId, { $set: baseDoc }, { new: true });
        }
      } else {
        const createDoc = { ...baseDoc, images: [] };
        const createWithRetry = async (attemptsLeft) => {
          try {
            return await Listing.create(createDoc);
          } catch (err) {
            const msg = String(err?.message || "");
            const isDupShortId =
              err?.code === 11000 &&
              (err?.keyPattern?.shortId || err?.keyValue?.shortId || /shortId/i.test(msg));
            if (!isDupShortId || attemptsLeft <= 1) throw err;
            return createWithRetry(attemptsLeft - 1);
          }
        };
        created = await createWithRetry(5);
      }

      if (!created) throw new Error(editingListingId ? "listing-update-failed" : "listing-create-failed");

      const listingId = created?._id?.toString?.() ?? String(created?._id || "");
      const shortId = getShortIdFromListing(created);
      const actionText = editingListingId ? "Listing updated." : "Listing published.";

      const confirmText = [
        actionText,
        shortId ? `🏷️ CODE: ${shortId}` : null,
        listingId ? `🆔 ID: ${listingId}` : null,
        `🏠 Title: ${title}`,
        `📍 Suburb: ${suburb}`,
        `🏢 Type: ${listingTypeTitle || listingTypeNormalized}`,
        `📋 Category: ${propertyTypeByListingType}`,
        bedroomsId ? `🛏️ Bedrooms: ${bedroomsId}` : null,
        `💰 Price: ${pricePerMonth}`,
      ].filter(Boolean).join("\n");

      await sendTextWithInstructionHeader(phone, confirmText, actionText);

      if (editingListingId) {
        // Edit flow: Done.
        const buttons = [
          { id: `edit_listing_${listingId}`, title: "✏️ Edit Details" },
          { id: `manage_photos_${listingId}`, title: "📷 Manage Photos" },
          { id: "menu_main", title: "🏠 Main Menu" }
        ];
        await sendInteractiveButtons(phone, "✅ Update complete. What would you like to do next?", buttons, { headerText: "Listing Updated" });

        // Clear state
        if (dbAvailable && savedMsg && savedMsg._id) {
          await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.state": "IDLE" } }).catch(() => null);
        }
        return NextResponse.json({ ok: true, note: "list-flow-updated-done", listingId });
      } else {
        // New Listing flow: Prompt for photos
        await sendInteractiveButtons(
          phone,
          "📸 Now, please send up to 5 photos for your listing.\n\nTap 'Done' when you are finished sending photos.",
          [{ id: "done_photos_new", title: "Done" }],
          { headerText: "Upload Photos" }
        );

        // Update state to AWAITING_PHOTOS
        if (dbAvailable && savedMsg && savedMsg._id) {
          await Message.findByIdAndUpdate(savedMsg._id, {
            $set: {
              "meta.state": "AWAITING_PHOTOS",
              "meta.listingId": listingId,
              "meta.photoCount": 0
            }
          }).catch(() => null);
        }
        return NextResponse.json({ ok: true, note: "list-flow-published-awaiting-photos", listingId });
      }
    } catch (e) {
      console.error("[webhook] list property flow error FULL:", e);
      const msg = e instanceof Error ? e.message : String(e);
      const isValidation = e?.name === "ValidationError" || /validation/i.test(msg);
      const isDup = e?.code === 11000;
      const ref = msgId ? String(msgId).slice(-6) : _hash(`${phone}:${Date.now()}`).slice(0, 6).toUpperCase();
      try {
        if (dbAvailable && savedMsg && savedMsg._id && typeof Message?.findByIdAndUpdate === "function") {
          await Message.findByIdAndUpdate(savedMsg._id, {
            $set: {
              "meta.publishError": {
                ref,
                name: String(e?.name || ""),
                code: e?.code ?? null,
                message: msg,
                stack: String(e?.stack || "").slice(0, 2000),
              },
            },
          }).catch(() => null);
        }
      } catch (err) { }
      const userMessage = isValidation
        ? "⚠️ Some values look invalid (for example: price). Please edit and submit the form again."
        : (isDup ? "⚠️ That listing code collided. Please submit the form again." : `❌ Something went wrong while publishing your listing. Ref: ${ref} Err: ${msg.slice(0, 200)}`);
      await sendWithMainMenuButton(phone, userMessage, "Tap Main menu and try again.");
      return NextResponse.json({ ok: true, note: "list-flow-error", error: msg, stack: String(e?.stack || "") });
    }
  }

  if (
    ["SEARCH", "BOARDING_SEARCH", "SHOP_SEARCH", "RENT_A_CHAIR_SEARCH"].includes(String(screen || "").toUpperCase()) ||
    (flowData && (flowData.city || flowData.q || flowData.min_price || flowData.max_price))
  ) {
    console.log("[webhook] flow search submission:", screen, flowData);

    const extractNumber = (value) => {
      const raw = String(value ?? "").replace(/,/g, " ").trim();
      const m = raw.match(/(\d+(?:\.\d+)?)/);
      if (!m) return null;
      const n = Number(m[1]);
      return Number.isFinite(n) ? n : null;
    };

    const normalizeCategory = (v) => {
      const raw = String(v || "").trim();
      if (!raw) return "";
      if (raw === "boarding_house") return "boarding";
      if (raw === "commercial_shop") return "commercial";
      return raw;
    };

    let results = { listings: [], total: 0 };
    try {
      const screenUpper = String(screen || "").toUpperCase();

      const minPrice = extractNumber(flowData.min_price);
      const maxPriceRaw = extractNumber(flowData.max_price);
      // Treat 0 as "no max price" to avoid filtering out everything by default
      const maxPrice = (maxPriceRaw === 0) ? null : maxPriceRaw;
      const q = String(flowData.q || "").trim();

      if (screenUpper === "BOARDING_SEARCH") {
        const resolvedCity = resolveTitleById(flowData.city, PREDEFINED_CITIES);
        const suburbRaw = String(flowData.suburb || "").trim();
        const resolvedSuburb = suburbRaw === "any" ? "" : resolveTitleById(suburbRaw, PREDEFINED_SUBURBS);

        const roomTypeId = String(flowData.roomType || flowData.room_type || "").trim();
        const roomTypeTitle = roomTypeId === "any" ? "" : resolveTitleById(roomTypeId, BOARDING_ROOM_TYPES);

        const featuresRaw =
          (Array.isArray(flowData.features) ? flowData.features : null) ||
          (Array.isArray(flowData.boarding_features) ? flowData.boarding_features : null) ||
          [];
        const resolvedFeatures = featuresRaw
          .map((fid) => String(fid || "").trim())
          .filter((fid) => fid && fid !== "any")
          .map((fid) => resolveTitleById(fid, BOARDING_FEATURES_OPTIONS))
          .map((v) => String(v || "").trim())
          .filter(Boolean)
          .slice(0, 12);

        results = await searchPublishedListings({
          q,
          city: resolvedCity || "",
          suburb: resolvedSuburb || "",
          minPrice,
          maxPrice,
          propertyCategory: "boarding",
          propertyType: roomTypeTitle || "",
          features: resolvedFeatures,
          perPage: 6,
        });
      } else if (screenUpper === "SHOP_SEARCH") {
        const resolvedCity = resolveTitleById(flowData.city, PREDEFINED_CITIES);
        const suburbRaw = String(flowData.suburb || "").trim();
        const resolvedSuburb = suburbRaw === "any" ? "" : resolveTitleById(suburbRaw, SHOP_SUBURBS);

        const shopTypeId = String(flowData.shopType || flowData.shop_type || "").trim();
        const shopTypeTitle = shopTypeId === "any" ? "" : resolveTitleById(shopTypeId, SHOP_TYPES);

        const featuresRaw =
          (Array.isArray(flowData.features) ? flowData.features : null) ||
          (Array.isArray(flowData.commercial_features) ? flowData.commercial_features : null) ||
          [];
        const resolvedFeatures = featuresRaw
          .map((fid) => String(fid || "").trim())
          .filter((fid) => fid && fid !== "any")
          .map((fid) => resolveTitleById(fid, SHOP_FEATURES_OPTIONS))
          .map((v) => String(v || "").trim())
          .filter(Boolean)
          .slice(0, 12);

        results = await searchPublishedListings({
          q,
          city: resolvedCity || "",
          suburb: resolvedSuburb || "",
          minPrice,
          maxPrice,
          propertyCategory: "commercial",
          propertyType: shopTypeTitle || "",
          features: resolvedFeatures,
          perPage: 6,
        });
      } else if (screenUpper === "RENT_A_CHAIR_SEARCH") {
        const serviceTypeId = String(flowData.serviceType || flowData.service_type || "").trim();
        const serviceTypeTitle = serviceTypeId === "any" ? "" : resolveTitleById(serviceTypeId, CHAIR_SERVICE_TYPES);

        const featuresRaw =
          (Array.isArray(flowData.features) ? flowData.features : null) ||
          (Array.isArray(flowData.chair_features) ? flowData.chair_features : null) ||
          [];
        const resolvedFeatures = featuresRaw
          .map((fid) => String(fid || "").trim())
          .filter((fid) => fid && fid !== "any")
          .map((fid) => resolveTitleById(fid, CHAIR_FEATURES_OPTIONS))
          .map((v) => String(v || "").trim())
          .filter(Boolean)
          .slice(0, 12);

        results = await searchPublishedListings({
          q,
          city: "",
          suburb: "",
          minPrice,
          maxPrice,
          propertyCategory: "rent_a_chair",
          propertyType: serviceTypeTitle || "",
          features: resolvedFeatures,
          perPage: 6,
        });
      } else {
        const resolvedCity = resolveTitleById(flowData.city, PREDEFINED_CITIES);
        const suburbRaw = String(flowData.suburb || "").trim();
        const resolvedSuburb = suburbRaw === "any" ? "" : resolveTitleById(suburbRaw, PREDEFINED_SUBURBS);

        const categoryRaw = flowData.propertyCategory || flowData.property_category || "residential";
        const resolvedPropertyCategory = normalizeCategory(categoryRaw) || "residential";

        const propertyTypeId = String(flowData.propertyType || flowData.property_type || "").trim();
        const resolvedPropertyType = propertyTypeId ? resolveTitleById(propertyTypeId, PREDEFINED_PROPERTY_TYPES) : "";

        const bedroomsRaw = String(flowData.bedrooms || "").trim();
        const minBeds =
          bedroomsRaw === "any" || bedroomsRaw === ""
            ? null
            : (bedroomsRaw === "5plus" ? 5 : Number(bedroomsRaw));
        const minBedsSafe = Number.isFinite(minBeds) ? minBeds : null;

        const featuresRaw =
          (Array.isArray(flowData.features) ? flowData.features : null) ||
          (Array.isArray(flowData.residential_features) ? flowData.residential_features : null) ||
          [];
        const resolvedFeatures = featuresRaw
          .map((fid) => String(fid || "").trim())
          .filter((fid) => fid && fid !== "any")
          .map((fid) => resolveTitleById(fid, PREDEFINED_FEATURES_OPTIONS))
          .map((v) => String(v || "").trim())
          .filter(Boolean)
          .slice(0, 12);

        results = await searchPublishedListings({
          q,
          city: resolvedCity || "",
          suburb: resolvedSuburb || "",
          minPrice,
          maxPrice,
          propertyCategory: resolvedPropertyCategory,
          propertyType: resolvedPropertyType || "",
          minBeds: minBedsSafe,
          features: resolvedFeatures,
          perPage: 6,
        });
      }
    } catch (e) {
      console.warn("[webhook] flow search error", e);
    }

    const items = (results.listings || []).slice(0, 6);
    if (!items.length) {
      await sendWithMainMenuButton(phone, "🔍 No matches found for your search.", "Try adjusting filters or a broader search.");
      return NextResponse.json({ ok: true, note: "flow-search-no-results" });
    }

    const ensured = items.map((item, i) => ensureListingHasId(item, i));
    const ensuredItems = ensured.map((e) => e.listing).filter(Boolean);
    const ids = ensured.map((e) => e.id).filter(Boolean);
    const numbered = ensuredItems.map((l, i) => formatListingResultText(l, i)).filter(Boolean).join("\n\n");

    await saveSearchContext(phone, ids, ensuredItems, dbAvailable);
    let msgText = `👇 Reply with the number (e.g. 1) to get contact details, or type a listing CODE (e.g. H4WH).\n\n${numbered}`.trim();

    const navButtons = [
      { id: "menu_search", title: "Return to Search" },
      { id: "menu_main", title: "Main Menu" }
    ];

    // If message is short enough, send as interactive button message (attached buttons)
    if (msgText.length <= 1024) {
      await sendInteractiveButtons(
        phone,
        msgText,
        navButtons
        // No header to keep it clean
      );
    } else {
      // Fallback for long messages: separate text + buttons
      if (msgText.length > 3900) msgText = `${msgText.slice(0, 3880).trim()}\n…`;
      await sendText(phone, msgText);

      // Add navigation buttons with minimal body text
      await sendInteractiveButtons(
        phone,
        "👇",
        navButtons
        // No header
      );
    }

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

  // edit my listings
  if (cmd === "menu_edit_listings" || cmd === "edit my listings") {
    if (dbAvailable && typeof Listing?.find === "function") {
      let myListings = await Listing.find({ listerPhoneNumber: phone }).sort({ createdAt: -1 }).limit(10).lean().exec().catch(() => []);
      if (!myListings.length) {
        // Fallback: try without country code if starts with 263
        let altPhone = null;
        if (phone.startsWith("263")) {
          altPhone = "0" + phone.slice(3);
        }

        let myListingsAlt = [];
        if (altPhone) {
          myListingsAlt = await Listing.find({ listerPhoneNumber: altPhone }).sort({ createdAt: -1 }).limit(10).lean().exec().catch(() => []);
        }

        if (myListingsAlt.length > 0) {
          myListings = myListingsAlt;
        } else {
          // Fallback 2: Regex search for last 8 digits (catch-all for format mismatches)
          const last8 = phone.length > 8 ? phone.slice(-8) : phone;
          console.log(`[edit-listings] Try regex fallback for last8: ${last8}`);
          const myListingsRegex = await Listing.find({ listerPhoneNumber: { $regex: last8, $options: "i" } }).sort({ createdAt: -1 }).limit(10).lean().exec().catch(() => []);

          if (myListingsRegex.length > 0) {
            myListings = myListingsRegex;
          } else {
            console.log(`[edit-listings] No listings found for phone: ${phone}`);
            await sendWithMainMenuButton(phone, `You don't have any listings yet. (ID: ${phone})`, "Tap Main menu, then List a property.");
            return NextResponse.json({ ok: true, note: "edit-listings-empty" });
          }
        }
      }

      const rows = myListings.map((l) => {
        const title = String(l.title || "Untitled").slice(0, 24);
        const price = l.pricePerMonth ? `$${l.pricePerMonth}` : "No Price";
        return {
          id: `edit_listing_${l._id}`,
          title: title,
          description: `${price} - ${String(l.suburb || "").slice(0, 20)}`
        };
      });

      rows.push({
        id: "menu_main",
        title: "🏠 Main Menu",
        description: "Return to main menu"
      });

      await sendInteractiveList(phone, "Select a listing to edit:", rows, { headerText: "Your Listings", buttonText: "Edit", sectionTitle: "My Listings" });
      return NextResponse.json({ ok: true, note: "edit-listings-sent" });
    }
    return NextResponse.json({ ok: true, note: "edit-listings-no-db" });
  }

  // handle listing selection for edit
  if (cmd.startsWith("edit_listing_")) {
    const listingId = cmd.replace("edit_listing_", "");
    if (dbAvailable && typeof Listing?.findById === "function") {
      const listing = await Listing.findById(listingId).lean().exec().catch(() => null);
      if (!listing) {
        await sendWithMainMenuButton(phone, "Listing not found.", "Tap Main menu.");
        return NextResponse.json({ ok: true, note: "edit-listing-not-found" });
      }

      // OLD CODE REMOVED
      const isPublished = listing.status === "published";
      const statusAction = isPublished ? "Deactivate" : "Activate";

      const rows = [
        { id: `edit_details_${listingId}`, title: "✏️ Edit Details", description: "Update listing info" },
        { id: `manage_photos_${listingId}`, title: "📷 Manage Photos", description: "Add/remove photos" },
        { id: `toggle_status_${listingId}`, title: statusAction, description: isPublished ? "Hide from search" : "Make visible" },
        { id: "menu_main", title: "🏠 Main Menu", description: "Return to main menu" }
      ];

      const title = String(listing.title || "Untitled");
      const statusDisplay = isPublished ? "✅ Active" : "⏸️ Inactive";
      const body = `Manage Listing: ${title}\nStatus: ${statusDisplay}\n\nChoose an action:`;

      await sendInteractiveList(phone, body, rows, { headerText: "Listing Options", buttonText: "Actions" });
      return NextResponse.json({ ok: true, note: "edit-listing-menu-sent" });

    }
  }

  // Handle direct report command from button (attached to listing details)
  if (cmd.startsWith("report_listing_") || cmd.startsWith("report_purchase_")) {
    const listingId = cmd.startsWith("report_listing_")
      ? cmd.replace("report_listing_", "")
      : cmd.replace("report_purchase_", "");

    if (dbAvailable && savedMsg && savedMsg._id) {
      await Message.findByIdAndUpdate(savedMsg._id, {
        $set: { "meta.report.listingId": listingId, "meta.state": "REPORT_WAIT_REASON" }
      }).catch(() => null);
    }

    const seriousMsg = "🛡️ *We take your reports seriously.*\n\nCribMatch is committed to a safe marketplace. Reports help us remove scammers and keep listings accurate. Every report is reviewed by our security team.\n\n*Step 2 of 3: Why are you reporting this?*";
    const reasons = [
      { id: "reason_scam", title: "🚨 Scam / Fraud", description: "Asking for money before viewing" },
      { id: "reason_rented", title: "✅ Already Rented", description: "Property is no longer available" },
      { id: "reason_price", title: "💰 Wrong Price", description: "Price is different from listing" },
      { id: "reason_fake", title: "🖼️ Fake Photos", description: "Photos don't match property" },
      { id: "reason_other", title: "❓ Other Category", description: "Something else is wrong" },
      { id: "menu_main", title: "🏠 Cancel", description: "Back to main menu" }
    ];

    await sendInteractiveList(phone, seriousMsg, reasons, { headerText: "Report Listing", buttonText: "Choose Reason" });
    return NextResponse.json({ ok: true, note: "report-step2-reasons-sent" });
  }

  // Handle "Edit Details" -> Opens the Flow
  if (cmd.startsWith("edit_details_")) {
    const listingId = cmd.replace("edit_details_", "");
    if (dbAvailable && typeof Listing?.findById === "function") {
      const listing = await Listing.findById(listingId).lean().exec().catch(() => null);
      if (!listing) {
        await sendWithMainMenuButton(phone, "Listing not found.", "Tap Main menu.");
        return NextResponse.json({ ok: true, note: "edit-details-not-found" });
      }

      const suburbParts = String(listing.suburb || "").split(",");
      const suburbTitle = suburbParts[0]?.trim();
      const cityTitle = suburbParts[1]?.trim() || "Harare";

      const payloadOverrides = {
        listing_type: listing.propertyCategory || "residential",
        title: listing.title || "",
        lister_phone_number: listing.listerPhoneNumber || "",
        contact_name: listing.contactName || "",
        contact_phone: listing.contactPhone || "",
        contact_whatsapp: listing.contactWhatsApp || "",
        contact_email: listing.contactEmail || "",
        selected_city: resolveIdByTitle(cityTitle, PREDEFINED_CITIES) || "harare",
        selected_suburb: resolveIdByTitle(suburbTitle, PREDEFINED_SUBURBS) || "any",
        selected_property_type: listing.propertyCategory === "residential" ? (resolveIdByTitle(listing.propertyType, PREDEFINED_PROPERTY_TYPES) || "any") : "any",
        selected_shop_type: listing.propertyCategory === "commercial" ? (resolveIdByTitle(listing.propertyType, SHOP_TYPES) || "any") : "any",
        selected_room_type: listing.propertyCategory === "boarding" ? (resolveIdByTitle(listing.propertyType, BOARDING_ROOM_TYPES) || "any") : "any",
        selected_service_type: listing.propertyCategory === "rent_a_chair" ? (resolveIdByTitle(listing.propertyType, CHAIR_SERVICE_TYPES) || "any") : "any",
        selected_bedrooms: String(listing.bedrooms || "any"),
        selected_occupancy: String(listing.occupancy || "any"),
        selected_gender: String(listing.genderPreference || "any"),
        selected_duration: String(listing.duration || "any"),
        number_of_students: String(listing.numberOfStudents || "1"),
        price_per_month: String(listing.pricePerMonth || ""),
        deposit_amount: String(listing.deposit || ""),
        description: listing.description || "",
        selected_residential_features: (listing.features || []).map(f => resolveIdByTitle(f, PREDEFINED_FEATURES_OPTIONS)).filter(Boolean),
        selected_boarding_features: (listing.features || []).map(f => resolveIdByTitle(f, BOARDING_FEATURES_OPTIONS)).filter(Boolean),
        selected_commercial_features: (listing.features || []).map(f => resolveIdByTitle(f, SHOP_FEATURES_OPTIONS)).filter(Boolean),
        selected_chair_features: (listing.features || []).map(f => resolveIdByTitle(f, CHAIR_FEATURES_OPTIONS)).filter(Boolean),
      };

      const flowResp = await sendListPropertyFlow(phone, {
        headerText: "Edit Listing",
        bodyText: "Update the fields below. Submit to save changes.",
        footerText: "Update Listing",
        flow_cta: "Update",
        payloadOverrides
      });

      if (flowResp?.error) {
        await sendWithMainMenuButton(phone, "Couldn't open the edit form.", "Tap Main menu.");
        return NextResponse.json({ ok: true, note: "edit-flow-failed" });
      }

      if (savedMsg && savedMsg._id) {
        await Message.findByIdAndUpdate(savedMsg._id, {
          $set: { "meta.state": "EDITING_LISTING", "meta.editingListingId": listingId }
        }).catch(() => null);
      }
      return NextResponse.json({ ok: true, note: "edit-flow-opened" });
    }
  }

  // Handle "Toggle Status"
  if (cmd.startsWith("toggle_status_")) {
    const listingId = cmd.replace("toggle_status_", "");
    if (dbAvailable && typeof Listing?.findByIdAndUpdate === "function") {
      const listing = await Listing.findById(listingId).select("status title").lean().exec().catch(() => null);
      if (!listing) return NextResponse.json({ ok: true });

      const newStatus = listing.status === "published" ? "draft" : "published";
      await Listing.findByIdAndUpdate(listingId, { $set: { status: newStatus } });

      const msg = newStatus === "published"
        ? `Listing "${listing.title}" is now ACTIVE.`
        : `Listing "${listing.title}" is now INACTIVE (Draft).`;

      await sendInteractiveButtons(phone, msg, [{ id: `edit_listing_${listingId}`, title: "Back to Listing" }], { headerText: "Status Updated" });
      return NextResponse.json({ ok: true, note: "status-toggled" });
    }
  }

  // Handle "Manage Photos" Menu
  if (cmd.startsWith("manage_photos_")) {
    const listingId = cmd.replace("manage_photos_", "").trim();
    if (dbAvailable && typeof Listing?.findById === "function") {
      const listing = await Listing.findById(listingId).select("images title").lean().exec().catch(() => null);
      if (!listing) return NextResponse.json({ ok: true });

      const count = (listing.images || []).length;
      const body = `📷 Photos for "${listing.title}"\n📊 Current count: ${count} photo(s).`;

      const rows = [
        { id: `view_photos_${listingId}`, title: "👁️ View Photos", description: "See current photos" },
        { id: `add_photos_${listingId}`, title: "➕ Add Photos", description: "Upload new photos" },
        { id: `delete_photos_menu_${listingId}`, title: "🗑️ Delete Photos", description: "Remove specific photos" },
        { id: `edit_listing_${listingId}`, title: "🔙 Back", description: "Return to listing menu" }
      ];

      await sendInteractiveList(phone, body, rows, {
        headerText: "📸 Manage Photos",
        buttonText: "Options",
        sectionTitle: "Actions"
      });
      return NextResponse.json({ ok: true, note: "manage-photos-menu" });
    }
  }

  // Handle "View Photos"
  if (cmd.startsWith("view_photos_")) {
    const listingId = cmd.replace("view_photos_", "").trim();
    if (dbAvailable && typeof Listing?.findById === "function") {
      const listing = await Listing.findById(listingId).select("images title").lean().exec().catch(() => null);
      if (!listing) return NextResponse.json({ ok: true });

      const images = listing.images || [];
      if (images.length === 0) {
        await sendInteractiveButtons(phone, "No photos to view.", [{ id: `manage_photos_${listingId}`, title: "🔙 Back" }], { headerText: "View Photos" });
        return NextResponse.json({ ok: true, note: "view-photos-empty" });
      }

      await sendText(phone, `📷 Sending ${images.length} photo(s) for "${listing.title}"...`);
      await sendImages(phone, images, { max: 10, caption: listing.title });

      // Show menu again after a short delay (or just send it)
      const rows = [
        { id: `add_photos_${listingId}`, title: "➕ Add Photos", description: "Upload new photos" },
        { id: `delete_photos_menu_${listingId}`, title: "🗑️ Delete Photos", description: "Remove specific photos" },
        { id: `manage_photos_${listingId}`, title: "🔙 Back to Menu", description: "Return to photo menu" }
      ];

      await sendInteractiveList(phone, "What would you like to do next?", rows, {
        headerText: "Photos Sent",
        buttonText: "Next",
        sectionTitle: "Options"
      });

      return NextResponse.json({ ok: true, note: "view-photos-sent" });
    }
  }

  // Handle "Delete Photos Menu"
  if (cmd.startsWith("delete_photos_menu_")) {
    const listingId = cmd.replace("delete_photos_menu_", "");
    // Clear selection state and set flow state
    if (savedMsg && savedMsg._id) {
      await Message.findByIdAndUpdate(savedMsg._id, {
        $unset: { "meta.deleteSelection": "" },
        $set: { "meta.state": "DELETING_PHOTOS" }
      }).catch(() => null);
    }
    await showDeletePhotosMenu(phone, listingId, []);
    return NextResponse.json({ ok: true, note: "delete-photos-menu" });
  }

  // Handle "Toggle Photo Selection"
  if (cmd.startsWith("toggle_photo_delete_")) {
    const parts = cmd.replace("toggle_photo_delete_", "").split("_");
    const idxStr = parts.pop();
    const listingId = parts.join("_");
    const idx = parseInt(idxStr, 10);

    if (!isNaN(idx)) {
      // Get previous selection
      const currentSelection = lastMeta?.deleteSelection || [];
      const newSelection = currentSelection.includes(idx)
        ? currentSelection.filter(i => i !== idx)
        : [...currentSelection, idx];

      // Save selection state and ensure we stay in DELETING_PHOTOS state so lastMeta picks this up
      if (savedMsg && savedMsg._id) {
        await Message.findByIdAndUpdate(savedMsg._id, {
          $set: {
            "meta.deleteSelection": newSelection,
            "meta.state": "DELETING_PHOTOS"
          }
        }).catch(() => null);
      }

      await showDeletePhotosMenu(phone, listingId, newSelection);
      return NextResponse.json({ ok: true, note: "photo-selection-toggled" });
    }
  }

  // Handle "Confirm Delete Selected Photos"
  if (cmd.startsWith("confirm_delete_photos_")) {
    const listingId = cmd.replace("confirm_delete_photos_", "");
    const selection = lastMeta?.deleteSelection || [];

    if (selection.length > 0 && dbAvailable && typeof Listing?.findById === "function") {
      const listing = await Listing.findById(listingId).exec().catch(() => null);
      if (listing && Array.isArray(listing.images)) {
        // Filter out selected indices
        // IMPORTANT: We must filter based on index, so we keep items where index is NOT in selection
        const newImages = listing.images.filter((_, i) => !selection.includes(i));

        listing.images = newImages;
        await listing.save();

        await sendText(phone, `✅ Deleted ${selection.length} photo(s).`);
      }

      // Reset selection and keep state active for further deletions if needed
      if (savedMsg && savedMsg._id) {
        await Message.findByIdAndUpdate(savedMsg._id, {
          $set: { "meta.state": "DELETING_PHOTOS", "meta.deleteSelection": [] }
        }).catch(() => null);
      }
      await showDeletePhotosMenu(phone, listingId, []);
      return NextResponse.json({ ok: true, note: "photos-deleted-selection" });
    } else {
      await sendText(phone, "⚠️ No photos selected.");
      // Ensure state is preserved even if nothing was deleted
      if (savedMsg && savedMsg._id) {
        await Message.findByIdAndUpdate(savedMsg._id, {
          $set: { "meta.state": "DELETING_PHOTOS", "meta.deleteSelection": [] }
        }).catch(() => null);
      }
      await showDeletePhotosMenu(phone, listingId, []);
      return NextResponse.json({ ok: true, note: "photos-deleted-none" });
    }
  }

  // Handle "Add Photos"
  if (cmd.startsWith("add_photos_")) {
    const listingId = cmd.replace("add_photos_", "");
    if (savedMsg && savedMsg._id) {
      await Message.findByIdAndUpdate(savedMsg._id, {
        $set: {
          "meta.state": "AWAITING_PHOTOS_EDIT",
          "meta.listingId": listingId,
          "meta.photoCount": 0 // Reset session count, but doesn't delete existing
        }
      }).catch(() => null);
    }
    await sendInteractiveButtons(
      phone,
      "📤 Please send your photos now.\n\nTap 'Done' when you are finished sending photos.",
      [{ id: "done_photos_edit", title: "Done" }],
      { headerText: "Add Photos" }
    );
    return NextResponse.json({ ok: true, note: "awaiting-photos-set" });
  }

  // lookup by CODE (4 chars)
  {
    const codeMatch = userRaw.match(/^(?:id|code)\s+([a-z0-9]{4})$/i) || userRaw.match(/^([a-z0-9]{4})$/i);
    const code = codeMatch ? String(codeMatch[1] || codeMatch[0]).trim().toUpperCase() : "";
    if (code && /^[A-Z0-9]{4}$/.test(code) && !["MENU", "HELP", "LIST", "OPEN", "VIEW"].includes(code)) {
      let listing = null;
      if (dbAvailable && typeof Listing?.findOne === "function") {
        listing = await Listing.findOne({ shortId: code }).lean().exec().catch(() => null);
      }
      if (!listing && selectionMap.has(phone)) {
        const mem = selectionMap.get(phone);
        listing = mem?.results?.find((r) => getShortIdFromListing(r) === code) || null;
      }
      if (!listing) {
        await sendWithMainMenuButton(phone, `❌ No listing found for CODE: ${code}`, "Tap Main menu to search.");
        return NextResponse.json({ ok: true, note: "code-not-found" });
      }
      await revealFromObject(listing, phone);
      await recordPurchase(phone, listing, dbAvailable);
      return NextResponse.json({ ok: true, note: "code-found" });
    }
  }

  // list a property
  if (cmd === "list" || cmd === "list a property" || cmd === "menu_list") {
    const flowResp = await sendListPropertyFlow(phone, {
      headerText: "📝 List a property",
      bodyText: "Ready to list your property? Fill out the form below to get started.\n\nRequired fields are marked.",
      footerText: "Open Listing Form",
      flow_cta: "📝 Create Listing",
    }).catch((e) => ({ error: e }));

    if (flowResp?.suppressed) {
      return NextResponse.json({ ok: true, note: "list-flow-suppressed", flowResp });
    }
    if (flowResp?.error) {
      await sendWithMainMenuButton(phone, "⚠️ Couldn't open the listing form right now.", "Tap Main menu and try again.");
      return NextResponse.json({ ok: true, note: "list-flow-open-failed" });
    }

    return NextResponse.json({ ok: true, note: "list-flow-opened" });
  }

  if (cmd === "help") {
    await sendWithMainMenuButton(
      phone,
      "❓ Help Center\n\n• Tap buttons to choose options.\n• Reply with numbers (e.g. 1) when seeing a list.\n• Type 'menu' anytime to start over.",
      "Tap Main menu to continue."
    );
    return NextResponse.json({ ok: true, note: "help" });
  }

  // SEARCH command (robust)
  if (cmd === "search" || cmd === "search properties" || cmd === "menu_search") {
    const rows = [
      { id: "search_residential", title: "🏠 Residential Housing", description: "Apartments, Houses, Rooms" },
      { id: "search_rent_a_chair", title: "💇 Rent a Chair", description: "Salon/Barber Spaces" },
      { id: "search_boarding", title: "🛏️ Boarding House", description: "Student/Shared Accommodation" },
      { id: "search_shop", title: "🏪 Commercial/Shop", description: "Retail & Office Spaces" },
      { id: "search_code", title: "🔢 Search by Code", description: "Enter a 4-digit property code" },
      { id: "menu_main", title: "🏠 Main Menu", description: "Return to main menu" },
    ];
    await sendInteractiveList(
      phone,
      "🔍 What are you looking for?",
      rows,
      {
        headerText: "Property Search",
        buttonText: "Categories",
        sectionTitle: "Select a Category"
      }
    );
    return NextResponse.json({ ok: true, note: "search-category-picker" });
  }

  if (cmd === "search_residential") {
    const flowResp = await sendResidentialSearchFlow(phone).catch((e) => ({ error: e }));
    if (flowResp?.suppressed) {
      return NextResponse.json({ ok: true, note: "search-residential-suppressed", flowResp });
    }
    if (flowResp?.error) {
      await sendWithMainMenuButton(phone, "⚠️ Couldn't open residential search.", "Tap Main menu and try again.");
      return NextResponse.json({ ok: true, note: "search-residential-open-failed", flowResp });
    }
    return NextResponse.json({ ok: true, note: "search-residential-opened", flowResp });
  }

  if (cmd === "search_boarding") {
    const flowResp = await sendBoardingSearchFlow(phone).catch((e) => ({ error: e }));
    if (flowResp?.suppressed) {
      return NextResponse.json({ ok: true, note: "search-boarding-suppressed", flowResp });
    }
    if (flowResp?.error) {
      await sendWithMainMenuButton(phone, "⚠️ Couldn't open boarding search.", "Tap Main menu and try again.");
      return NextResponse.json({ ok: true, note: "search-boarding-open-failed", flowResp });
    }
    return NextResponse.json({ ok: true, note: "search-boarding-opened", flowResp });
  }

  if (cmd === "search_shop") {
    const flowResp = await sendShopSearchFlow(phone).catch((e) => ({ error: e }));
    if (flowResp?.suppressed) {
      return NextResponse.json({ ok: true, note: "search-shop-suppressed", flowResp });
    }
    if (flowResp?.error) {
      await sendWithMainMenuButton(phone, "⚠️ Couldn't open commercial search.", "Tap Main menu and try again.");
      return NextResponse.json({ ok: true, note: "search-shop-open-failed", flowResp });
    }
    return NextResponse.json({ ok: true, note: "search-shop-opened", flowResp });
  }

  if (cmd === "search_rent_a_chair") {
    const flowResp = await sendRentAChairSearchFlow(phone).catch((e) => ({ error: e }));
    if (flowResp?.suppressed) {
      return NextResponse.json({ ok: true, note: "search-chair-suppressed", flowResp });
    }
    if (flowResp?.error) {
      await sendWithMainMenuButton(phone, "⚠️ Couldn't open rent-a-chair search.", "Tap Main menu and try again.");
      return NextResponse.json({ ok: true, note: "search-chair-open-failed", flowResp });
    }
    return NextResponse.json({ ok: true, note: "search-chair-opened", flowResp });
  }

  /* -------------------------
     Handle "Search by Code"
  ------------------------- */
  if (cmd === "search_code") {
    await sendWithMainMenuButton(
      phone,
      "🔢 Please enter the 4-character Property Code (e.g. SIVR):",
      "Type the code to view details."
    );

    // Save state
    if (savedMsg && typeof Message?.findByIdAndUpdate === "function") {
      await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.state": "AWAITING_SEARCH_CODE" } }).catch(() => null);
    }
    return NextResponse.json({ ok: true, note: "awaiting-search-code" });
  }

  /* -------------------------
     Handle "View past purchases"
  ------------------------- */
  if (cmd === "menu_purchases" || cmd === "view past purchases" || cmd === "past purchases") {
    if (dbAvailable && typeof Purchase?.find === "function") {
      const purchases = await Purchase.find({ phone: digitsOnly(phone) })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean()
        .exec()
        .catch(() => []);

      if (!purchases || purchases.length === 0) {
        await sendInteractiveButtons(phone, "🛍️ You haven't viewed any properties yet.", [{ id: "menu_search", title: "🔍 Search Properties" }], { headerText: "No History" });
        return NextResponse.json({ ok: true, note: "no-purchases" });
      }

      // Manual populate to handle both DB listings and snapshots (e.g. seed listings)
      const listingIds = purchases.map(p => p.listingId).filter(Boolean);
      let foundListings = [];

      if (listingIds.length > 0 && typeof Listing?.find === "function") {
        try {
          // Only query valid ObjectIds to prevent CastError
          const validObjectIds = listingIds.filter(id => /^[0-9a-fA-F]{24}$/.test(id));
          if (validObjectIds.length > 0) {
            foundListings = await Listing.find({ _id: { $in: validObjectIds } })
              .select("title status price currency")
              .lean()
              .exec();
          }
        } catch (e) {
          console.warn("[menu_purchases] Manual populate error", e);
        }
      }

      const rows = purchases
        .map((p) => {
          const id = p.listingId;
          let listing = foundListings.find(l => String(l._id) === String(id));
          let fromSnapshot = false;

          // Fallback to snapshot if not found in DB (e.g. seed listing or deleted)
          if (!listing && p.listingSnapshot) {
            listing = { ...p.listingSnapshot, _id: id };
            fromSnapshot = true;
          }

          if (!listing) return null;

          const isPublished = listing.status === "published";
          const statusTag = isPublished ? "✅" : "❌";
          const priceStr = listing.price ? `${listing.currency || "USD"} ${listing.price}` : "";

          return {
            id: `select_${listing._id}`,
            title: String(listing.title || "Untitled").slice(0, 24),
            description: `${statusTag} ${priceStr}`.trim().slice(0, 72)
          };
        })
        .filter(Boolean);

      if (rows.length === 0) {
        await sendInteractiveButtons(phone, "⚠️ No valid purchases found.", [{ id: "menu_main", title: "🏠 Main Menu" }]);
        return NextResponse.json({ ok: true, note: "no-valid-purchases" });
      }

      rows.push({
        id: "menu_main",
        title: "🏠 Main Menu",
        description: "Return to main menu"
      });

      await sendInteractiveList(phone, "Here are your past viewed properties:", rows, {
        headerText: "🛍️ Past Purchases",
        buttonText: "View",
        sectionTitle: "Select Property"
      });
      return NextResponse.json({ ok: true, note: "purchases-list-sent" });
    } else {
      await sendInteractiveButtons(phone, "⚠️ History unavailable.", [{ id: "menu_main", title: "🏠 Main Menu" }]);
      return NextResponse.json({ ok: true, note: "db-unavailable" });
    }
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
      await sendWithMainMenuButton(phone, "📭 You haven't requested any contacts yet.", "Tap 'Search properties' to find listings.");
      return NextResponse.json({ ok: true, note: "no-past-messages" });
    }
    let found = [];
    if (dbAvailable && typeof Listing?.find === "function") {
      try { found = await Listing.find({ _id: { $in: listingIds } }).lean().exec().catch(() => []); } catch (e) { found = []; }
    }
    const summaries = listingIds.map((id) => {
      const f = found.find((x) => String(x._id) === String(id));
      if (f) return { id, code: getShortIdFromListing(f), title: f.title || "Listing", suburb: f.suburb || "", price: f.pricePerMonth || f.price || 0 };
      const mem = selectionMap.get(phone);
      const r = mem?.results?.find((rr) => getIdFromListing(rr) === id) || null;
      if (r) return { id, code: getShortIdFromListing(r), title: r.title || "Listing", suburb: r.suburb || "", price: r.pricePerMonth || r.price || 0 };
      return { id, code: "", title: `Listing ${id.slice(0, 8)}`, suburb: "", price: 0 };
    });
    const text = ["💬 Your recent contacts:"].concat(
      summaries.map((s, i) => `${i + 1}) 🏠 ${s.title} — 📍 ${s.suburb} — 💰 $${s.price}${s.code ? ` — 🏷️ ${s.code}` : ""} — 🆔 ${s.id}`),
    ).join("\n\n");
    await sendTextWithInstructionHeader(phone, text, "Reply with the number (e.g. 1) to view contact details again.");
    await sendButtonsWithInstructionHeader(phone, "Return to main menu:", [{ id: "menu_main", title: "🏠 Main menu" }], "Tap Main menu.");
    selectionMap.set(phone, { ids: listingIds, results: summaries.map((s) => ({ _id: s.id, shortId: s.code, title: s.title, suburb: s.suburb, price: s.price })) });
    return NextResponse.json({ ok: true, note: "past-messages-sent" });
  }

  // report listing
  if (cmd === "report listing" || cmd === "menu_report" || cmd === "report") {
    if (dbAvailable && typeof Purchase?.find === "function") {
      // Find user's purchases
      const purchases = await Purchase.find({ phone })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate("listingId")
        .lean()
        .exec()
        .catch(() => []);

      if (!purchases || purchases.length === 0) {
        await sendWithMainMenuButton(
          phone,
          "❌ No Purchases Found\n\nYou can only report listings that you have previously viewed contact details for. Please search and unlock a listing first.",
          "Tap Main menu."
        );
        return NextResponse.json({ ok: true, note: "report-no-purchases" });
      }

      const rows = purchases.map((p) => {
        const l = p.listingId || p.listingSnapshot || {};
        const title = String(l.title || "Untitled Listing").slice(0, 24);
        const price = l.pricePerMonth ? `$${l.pricePerMonth}` : "N/A";
        const shortId = l.shortId || "ID";
        return {
          id: `report_purchase_${l._id || p.listingId}`,
          title: title,
          description: `${shortId} - ${price}`
        };
      });

      rows.push({
        id: "menu_main",
        title: "🏠 Main Menu",
        description: "Return to main menu"
      });

      await sendInteractiveList(
        phone,
        "Select a listing you have purchased to report:",
        rows,
        { headerText: "Report Listing", buttonText: "Select", sectionTitle: "Your Purchases" }
      );
      return NextResponse.json({ ok: true, note: "report-purchases-list-sent" });
    }

    // Fallback if DB not available or something else
    if (dbAvailable && savedMsg && savedMsg._id) await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.state": "REPORT_WAIT_ID" } }).catch(() => null);
    await sendWithMainMenuButton(phone, "⚠️ Report a listing.\n\nStep 1 of 2: What is the listing ID? (e.g. 60df12ab...)", "Reply with the listing ID.");
    return NextResponse.json({ ok: true, note: "report-started" });
  }

  /* -------------------------
     Listing creation flow
  ------------------------- */
  if (lastMeta && lastMeta.state && String(lastMeta.state).startsWith("LISTING_")) {
    if (dbAvailable && savedMsg && savedMsg._id) {
      await Message.findByIdAndUpdate(savedMsg._id, { $unset: { "meta.listingDraft": "", "meta.state": "" } }).catch(() => null);
    }
    await sendWithMainMenuButton(phone, "ℹ️ Listing is done using the form only.", "Tap Main menu, then choose List a property.");
    return NextResponse.json({ ok: true, note: "listing-form-only" });
  }

  /* -------------------------
     Report flow
  ------------------------- */
  if (lastMeta && lastMeta.state && lastMeta.state === "REPORT_WAIT_ID") {
    const listingIdInput = userRaw.trim();
    if (!listingIdInput) {
      await sendWithMainMenuButton(phone, "⚠️ Listing ID missing.", "Reply with the listing ID.");
      return NextResponse.json({ ok: true });
    }

    let listingId = listingIdInput;
    // Resolve shortId if needed
    if (dbAvailable && listingIdInput.length === 4 && /^[A-Z0-9]{4}$/i.test(listingIdInput)) {
      const l = await Listing.findOne({ shortId: listingIdInput.toUpperCase() }).lean().exec().catch(() => null);
      if (l) listingId = String(l._id);
    }

    // Verify purchase
    if (dbAvailable) {
      const hasPurchased = await Purchase.findOne({ phone, listingId }).lean().exec().catch(() => null);
      if (!hasPurchased) {
        await sendWithMainMenuButton(
          phone,
          "❌ Access Denied\n\nYou can only report listings that you have previously viewed contact details for. Please search and unlock a listing first.",
          "Tap Main menu."
        );
        if (savedMsg && savedMsg._id) await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.state": "IDLE" } }).catch(() => null);
        return NextResponse.json({ ok: true, note: "report-denied-no-purchase" });
      }
    }

    if (dbAvailable && savedMsg && savedMsg._id) {
      await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.report.listingId": listingId, "meta.state": "REPORT_WAIT_REASON" } }).catch(() => null);
    }

    const seriousMsg = "🛡️ *We take your reports seriously.*\n\nCribMatch is committed to a safe marketplace. Reports help us remove scammers and keep listings accurate. Every report is reviewed by our security team.\n\n*Step 2 of 3: Why are you reporting this?*";
    const reasons = [
      { id: "reason_scam", title: "🚨 Scam / Fraud", description: "Asking for money before viewing" },
      { id: "reason_rented", title: "✅ Already Rented", description: "Property is no longer available" },
      { id: "reason_price", title: "💰 Wrong Price", description: "Price is different from listing" },
      { id: "reason_fake", title: "🖼️ Fake Photos", description: "Photos don't match property" },
      { id: "reason_other", title: "❓ Other Category", description: "Something else is wrong" },
      { id: "menu_main", title: "🏠 Cancel", description: "Back to main menu" }
    ];
    await sendInteractiveList(phone, seriousMsg, reasons, { headerText: "Report Listing", buttonText: "Choose Reason" });
    return NextResponse.json({ ok: true, note: "report-step2" });
  }

  if (lastMeta && lastMeta.state && lastMeta.state === "REPORT_WAIT_REASON") {
    let reason = userRaw || "unspecified";
    if (reason.startsWith("reason_")) {
      reason = reason.replace("reason_", "").replace("_", " ").toUpperCase();
    }

    if (dbAvailable && savedMsg && savedMsg._id) {
      await Message.findByIdAndUpdate(savedMsg._id, {
        $set: {
          "meta.report.reason": reason,
          "meta.state": "REPORT_WAIT_STORY"
        }
      }).catch(() => null);
    }

    await sendWithMainMenuButton(
      phone,
      "📖 *Step 3 of 3: Tell us more.*\n\nPlease describe what happened or why you are reporting this listing. Your story helps our team take the right action.",
      "Reply with your story."
    );
    return NextResponse.json({ ok: true, note: "report-step3-story-wait" });
  }

  if (lastMeta && lastMeta.state && lastMeta.state === "REPORT_WAIT_STORY") {
    const story = userRaw || "";
    const reportData = lastMeta.report || {};
    const listingId = reportData.listingId;
    const reason = reportData.reason;

    if (dbAvailable) {
      try {
        const { Report } = await import("@/lib/db");
        await new Report({
          phone: digitsOnly(phone),
          listingId: listingId,
          reason: reason,
          story: story,
          status: 'pending'
        }).save();
      } catch (e) {
        console.error("[report] failed to save to DB:", e);
      }
    }

    if (dbAvailable && savedMsg && savedMsg._id) {
      await Message.findByIdAndUpdate(savedMsg._id, {
        $set: {
          "meta.report.story": story,
          "meta.report.submittedAt": new Date(),
          "meta.state": "REPORT_SUBMITTED"
        }
      }).catch(() => null);
    }

    await sendWithMainMenuButton(
      phone,
      "✅ *Report Submitted.*\n\nThank you for helping keep CribMatch safe. Our team will investigate this listing immediately. If we need more details, we will reach out to you.",
      "Tap Main menu."
    );
    return NextResponse.json({ ok: true, note: "report-finished" });
  }

  /* -------------------------
     images <id>
  ------------------------- */
  if (/^images?\b/i.test(userRaw) || /^view_images_/.test(userRaw)) {
    const m = userRaw.match(/^images?\s+(.+)$/i);
    const listingRef = /^view_images_/.test(userRaw) ? userRaw.slice("view_images_".length).trim() : (m ? m[1].trim() : null);
    if (!listingRef) {
      await sendWithMainMenuButton(phone, "⚠️ Image request missing listing ID.", "Reply like: images <listing-id>.");
      return NextResponse.json({ ok: true, note: "images-missing-id" });
    }
    const refUpper = String(listingRef).trim().toUpperCase();
    const imgHash = _hash(`images:${refUpper}`);
    if (!_shouldSend(phone, imgHash, TTL_INTERACTIVE_MS)) return NextResponse.json({ ok: true, note: "images-suppressed" });

    let listing = null;
    if (/^[A-Z0-9]{4}$/.test(refUpper) && dbAvailable && typeof Listing?.findOne === "function") {
      listing = await Listing.findOne({ shortId: refUpper }).lean().exec().catch(() => null);
    }
    if (!listing) {
      try { listing = await getListingById(listingRef).catch(() => null); } catch (e) { listing = null; }
    }
    if (!listing && typeof Listing?.findById === "function") listing = await Listing.findById(listingRef).lean().exec().catch(() => null);
    const imgs = (listing && (listing.images || listing.photos || listing.photosUrls || [])) || [];
    if (!imgs || imgs.length === 0) {
      await sendWithMainMenuButton(phone, "🖼️ No images found for this listing.", "Tap Main menu to continue.");
      return NextResponse.json({ ok: true, note: "images-not-found" });
    }
    const title = listing?.title ? String(listing.title) : "Listing";
    await sendTextWithInstructionHeader(phone, `📷 Sending photos for: ${title}`, "Photos will appear below.");
    await sendImages(phone, imgs, { max: 6, caption: `Photos: ${title}` });
    await sendButtonsWithInstructionHeader(phone, "Return to main menu:", [{ id: "menu_main", title: "🏠 Main menu" }], "Tap Main menu.");
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
      await sendWithMainMenuButton(phone, "⚠️ Couldn't determine the listing from your reply.", "Reply: contact <CODE> (e.g. H4WH) or contact <ID>.");
      return NextResponse.json({ ok: true, note: "selection-unknown" });
    }

    // try to fetch listing (helper + DB)
    let listing = listingFromResults;
    const listingIdUpper = String(listingId || "").trim().toUpperCase();
    if (!listing && /^[A-Z0-9]{4}$/.test(listingIdUpper) && dbAvailable && typeof Listing?.findOne === "function") {
      listing = await Listing.findOne({ shortId: listingIdUpper }).lean().exec().catch(() => null);
    }
    if (!listing && !String(listingId || "").startsWith("seed_")) {
      try { listing = await getListingById(listingId).catch(() => null); } catch (e) { listing = null; }
    }
    if (!listing && dbAvailable && typeof Listing?.findById === "function") listing = await Listing.findById(listingId).lean().exec().catch(() => null);
    if (!listing && Array.isArray(lastResults)) {
      listing =
        lastResults.find((r) => getShortIdFromListing(r) === listingIdUpper) ||
        lastResults.find((r) => getIdFromListing(r) === listingId || String(r._id) === listingId) ||
        null;
    }
    if (!listing) {
      await sendWithMainMenuButton(phone, "⚠️ Sorry, listing not found.", "Reply again with the number shown (e.g. 1), or tap Main menu.");
      return NextResponse.json({ ok: true, note: "listing-not-found" });
    }

    // reveal contact
    await revealFromObject(listing, phone);
    await recordPurchase(phone, listing, dbAvailable);

    // save that user viewed this contact
    if (dbAvailable && savedMsg && savedMsg._id) {
      await Message.findByIdAndUpdate(savedMsg._id, { $set: { "meta.listingIdSelected": getIdFromListing(listing) } }).catch(() => null);
    }

    // update selectionMap
    try {
      const mem = selectionMap.get(phone) || { ids: [], results: [] };
      const lid = getIdFromListing(listing);
      if (!mem.ids.includes(lid)) mem.ids.unshift(lid);
      if (!mem.results.find((r) => getIdFromListing(r) === lid)) {
        mem.results.unshift({
          _id: lid,
          shortId: getShortIdFromListing(listing),
          title: listing.title || "Listing",
          suburb: listing.suburb || "",
          price: listing.pricePerMonth || listing.price || 0,
        });
      }
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
    await sendWithMainMenuButton(phone, "ℹ️ Search is available via the form only.", "Tap Main menu, then choose Search properties.");
    return NextResponse.json({ ok: true, note: "search-form-only" });
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
      if (listing) { await revealFromObject(listing, phone); await recordPurchase(phone, listing, dbAvailable); return true; }
    } catch (e) { console.warn("[tryReveal] getListingById failed:", e); }

    // 2) Listing.findById
    try {
      if (typeof Listing?.findById === "function") {
        const dbListing = await Listing.findById(listingId).lean().exec().catch(() => null);
        if (dbListing) { await revealFromObject(dbListing, phone); await recordPurchase(phone, dbListing, dbAvailable); return true; }
      }
    } catch (e) { console.warn("[tryReveal] Listing.findById failed:", e); }

    // 3) fallback to resultsFromMeta mapping
    if (Array.isArray(idsFromMeta) && idsFromMeta.length > 0 && Array.isArray(resultsFromMeta)) {
      const idx = idsFromMeta.indexOf(listingId);
      if (idx >= 0 && resultsFromMeta[idx]) { await revealFromObject(resultsFromMeta[idx], phone); await recordPurchase(phone, resultsFromMeta[idx], dbAvailable); return true; }
    }

    // 4) defensive substring match
    if (Array.isArray(resultsFromMeta) && resultsFromMeta.length) {
      for (const r of resultsFromMeta) {
        const candidateId = getIdFromListing(r);
        if (candidateId && listingId && candidateId.includes(listingId)) { await revealFromObject(r, phone); await recordPurchase(phone, r, dbAvailable); return true; }
      }
    }

    await sendWithMainMenuButton(phone, "⚠️ Sorry, listing not found.", "If you still see results, reply again with the number shown (e.g. 1), or tap Main menu.");
    return false;
  } catch (e) {
    console.error("[tryRevealByIdOrCached] unexpected error:", e);
    try { await sendWithMainMenuButton(phone, "⚠️ Sorry — couldn't fetch contact details right now.", "Tap Main menu."); } catch { }
    return false;
  }
}

async function recordPurchase(phone, listing, dbAvailable) {
  if (!dbAvailable || !listing) return;
  try {
    const listingId = getIdFromListing(listing);
    if (!listingId) return;

    // Also save to Message (existing logic)
    if (typeof Message?.findOneAndUpdate === "function") {
      await Message.findOneAndUpdate({ phone: digitsOnly(phone) }, { $set: { "meta.listingIdSelected": listingId, "meta.state": "CONTACT_REVEALED" } }, { sort: { createdAt: -1 }, upsert: false }).exec().catch(() => null);
    }

    // Save to Purchase with snapshot
    if (typeof Purchase?.updateOne === "function") {
      const snapshot = {
        title: listing.title,
        price: listing.price || listing.pricePerMonth,
        currency: listing.currency,
        status: listing.status
      };
      await Purchase.updateOne(
        { phone: digitsOnly(phone), listingId: listingId },
        {
          $set: { listingSnapshot: snapshot },
          $setOnInsert: { createdAt: new Date() }
        },
        { upsert: true }
      ).exec();
    }
  } catch (e) { console.error("[recordPurchase] error:", e); }
}

async function revealFromObject(listing, phone) {
  try {
    if (!listing) { await sendWithMainMenuButton(phone, "⚠️ Sorry, listing not found.", "Tap Main menu."); return; }

    const { listing: ensuredListing, id: ensuredId } = ensureListingHasId(listing, 0);
    if (!ensuredListing) { await sendWithMainMenuButton(phone, "⚠️ Sorry, listing not found.", "Tap Main menu."); return; }

    listing = ensuredListing;
    const title = listing.title || listing.name || "Listing";
    const suburb = listing.suburb || listing.location?.suburb || "";
    const address = listing.address || listing.location?.address || "";
    const price = listing.pricePerMonth != null ? `$${listing.pricePerMonth}` : (listing.price != null ? `$${listing.price}` : "N/A");
    const bedrooms = listing.bedrooms != null ? `${listing.bedrooms} bed(s)` : "";
    const description = listing.description ? String(listing.description).slice(0, 700) : "";
    const features = Array.isArray(listing.features) ? listing.features.filter(Boolean) : [];
    const images = Array.isArray(listing.images) ? listing.images.filter(Boolean) : [];

    const contactName = listing.contactName || listing.ownerName || "Owner";
    const contactPhone = listing.contactPhone || listing.listerPhoneNumber || listing.contactWhatsApp || "N/A";
    const contactWhatsApp = listing.contactWhatsApp || "";
    const contactEmail = listing.contactEmail || listing.email || "";

    const code = getShortIdFromListing(listing);
    const detailsLines = [
      `🏠 Contact for: ${title}`,
      code ? `🏷️ CODE: ${code}` : null,
      ensuredId ? `🆔 Listing ID: ${ensuredId}` : null,
      suburb ? `📍 Suburb: ${suburb}` : null,
      address ? `📍 Address: ${address}` : null,
      bedrooms ? `🛏️ Bedrooms: ${bedrooms}` : null,
      `💰 Price: ${price}`,
      "",
      `👤 Contact: ${contactName}`,
      `📞 Phone: ${contactPhone}`,
      contactWhatsApp ? `📱 WhatsApp: ${contactWhatsApp}` : null,
      contactEmail ? `📧 Email: ${contactEmail}` : null,
    ].filter(Boolean);

    const blocks = [detailsLines.join("\n")];

    if (description) {
      blocks.push(`📝 Description:\n${description}`);
    }

    if (features && features.length) {
      blocks.push(`✨ Features:\n• ${features.slice(0, 12).join("\n• ")}`);
    }

    if (images.length) {
      blocks.push(`📷 Photos: ${images.length} image(s). Sending now...`);
    }

    let body = blocks.join("\n\n").trim();
    // Truncate to 1000 chars to ensure it fits in an interactive button message (limit ~1024)
    if (body.length > 1000) body = `${body.slice(0, 950).trim()}\n…\n(Reply 'more' for full text)`;

    // Send details with Report and Main menu buttons
    await sendInteractiveButtons(
      phone,
      body,
      [
        { id: `report_listing_${ensuredId}`, title: "🚩 Report Listing" },
        { id: "menu_main", title: "🏠 Main menu" }
      ],
      { headerText: "✅ Here are the details you requested:" }
    );

    if (images.length) {
      // NOTE: sendImages has built-in deduplication
      await sendImages(phone, images, { max: 6, caption: `📷 Photos: ${title}` });
    }
  } catch (e) {
    console.error("[revealFromObject] error:", e);
    try { await sendWithMainMenuButton(phone, "⚠️ Sorry — couldn't fetch contact details right now.", "Tap Main menu."); } catch { }
  }
}



async function fetchAndAddImageToListing(listingId, imageId, token) {
  if (!listingId || !imageId || !token) return;

  try {
    // 1. Get media URL from WhatsApp Graph API
    const mediaUrlResponse = await fetch(`https://graph.facebook.com/v24.0/${imageId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!mediaUrlResponse.ok) {
      console.error("[webhook] Failed to get media URL from WhatsApp:", await mediaUrlResponse.text());
      return;
    }

    const mediaData = await mediaUrlResponse.json();
    const downloadUrl = mediaData.url;
    const mimeType = mediaData.mime_type || "image/jpeg";
    const extension = mimeType.split("/")[1] || "jpg";

    if (!downloadUrl) {
      console.error("[webhook] No download URL in media data");
      return;
    }

    // 2. Download the actual image binary
    const imageResponse = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!imageResponse.ok) {
      console.error("[webhook] Failed to download image from WhatsApp:", await imageResponse.text());
      return;
    }

    const imageBuffer = await imageResponse.arrayBuffer();

    // 3. Upload to Supabase Storage
    const fileName = `${listingId}/${Date.now()}-${imageId}.${extension}`;
    const { data: uploadData, error: uploadError } = await supabaseAdmin
      .storage
      .from("listings")
      .upload(fileName, imageBuffer, {
        contentType: mimeType,
        upsert: true
      });

    if (uploadError) {
      console.error("[webhook] Supabase upload error:", uploadError);
      // Fallback to storing the imageId if upload fails, though it expires
      if (mongoose.connection.readyState === 1 && typeof Listing?.findByIdAndUpdate === "function") {
        await Listing.findByIdAndUpdate(listingId, { $push: { images: imageId } }).catch(() => null);
      }
      return;
    }

    // 4. Get the public URL
    const { data: { publicUrl } } = supabaseAdmin
      .storage
      .from("listings")
      .getPublicUrl(fileName);

    // 5. Save the public URL to the listing in MongoDB
    if (mongoose.connection.readyState === 1 && typeof Listing?.findByIdAndUpdate === "function") {
      await Listing.findByIdAndUpdate(listingId, { $push: { images: publicUrl } }).catch(() => null);
      console.log("[webhook] Image uploaded to Supabase and saved to listing:", publicUrl);
    }
  } catch (err) {
    console.error("[webhook] Error in fetchAndAddImageToListing:", err);
  }
}
