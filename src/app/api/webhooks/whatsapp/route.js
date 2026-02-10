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

async function sendInteractiveButtons(phoneNumber, bodyText, buttons = []) {
  const apiToken = process.env.WHATSAPP_API_TOKEN || process.env.WHATCHIMP_API_KEY;
  const phone_number_id =
    process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATCHIMP_PHONE_ID || process.env.WHATCHIMP_PHONE_NUMBER_ID;
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
  const apiToken = process.env.WHATSAPP_API_TOKEN || process.env.WHATCHIMP_API_KEY;
  const phone_number_id =
    process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATCHIMP_PHONE_ID || process.env.WHATCHIMP_PHONE_NUMBER_ID;
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
   Flow response builders (SEARCH + RESULTS)
   ------------------------- */
function buildSearchSchemaFlowResponse() {
  return {
    version: "7.3",
    screens: [
      {
        id: "SEARCH",
        title: "Find rentals — filters",
        terminal: true,
        success: true,
        data: {
          cities: PREDEFINED_CITIES.map((c) => ({ id: c.id, title: c.title })),
          suburbs: [],
          propertyCategories: [],
          propertyTypes: [],
          bedrooms: [],
          min_price: "0",
          max_price: "0",
          q: "",
          selected_city: "harare",
          selected_suburb: "any",
          selected_category: "residential",
          selected_type: "house",
          selected_bedrooms: "any",
        },
        layout: {
          type: "SingleColumnLayout",
          children: [
            {
              type: "Form",
              name: "search_form",
              "init-values": {
                city: "${data.selected_city}",
                suburb: "${data.selected_suburb}",
                property_category: "${data.selected_category}",
                property_type: "${data.selected_type}",
                bedrooms: "${data.selected_bedrooms}",
                min_price: "${data.min_price}",
                max_price: "${data.max_price}",
                q: "${data.q}",
              },
              children: [
                { type: "TextSubheading", text: "Find rentals — pick filters" },
                { type: "TextBody", text: "Choose from predefined options or leave blanks for broader search." },
                { type: "Dropdown", label: "City", required: true, name: "city", "data-source": "${data.cities}" },
                { type: "Dropdown", label: "Suburb (optional)", name: "suburb", "data-source": "${data.suburbs}" },
                { type: "Dropdown", label: "Property category", name: "property_category", "data-source": "${data.propertyCategories}" },
                { type: "Dropdown", label: "Property type", name: "property_type", "data-source": "${data.propertyTypes}" },
                { type: "Dropdown", label: "Bedrooms", name: "bedrooms", "data-source": "${data.bedrooms}" },
                { type: "TextInput", label: "Min price (optional)", name: "min_price" },
                { type: "TextInput", label: "Max price (optional)", name: "max_price" },
                { type: "TextInput", label: "Keyword (optional)", name: "q" },
                {
                  type: "Footer",
                  label: "Search",
                  "on-click-action": {
                    name: "complete",
                    payload: {
                      city: "${form.city}",
                      suburb: "${form.suburb}",
                      property_category: "${form.property_category}",
                      property_type: "${form.property_type}",
                      bedrooms: "${form.bedrooms}",
                      min_price: "${form.min_price}",
                      max_price: "${form.max_price}",
                      q: "${form.q}",
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

function buildResultsFlowResponseForListings(listings, incoming = {}) {
  const listingText = listings
    .map((l, i) => `${i + 1}) ${l.title} — ${l.suburb || ""} — $${l.pricePerMonth || l.price || "N/A"} — ID:${l._id || l.id || i}`)
    .slice(0, 3);

  return {
    version: "7.3",
    screens: [
      {
        id: "RESULTS",
        title: "Search results",
        data: {
          resultsCount: listings.length,
          listings: listings.map((l) => ({
            id: l._id || l.id || "",
            title: l.title || "",
            suburb: l.suburb || "",
            pricePerMonth: l.pricePerMonth || l.price || 0,
            bedrooms: l.bedrooms || "",
          })),
          querySummary: `Top ${listings.length} results`,
          listingText0: listingText[0] || "",
          listingText1: listingText[1] || "",
          listingText2: listingText[2] || "",
          hasResult0: Boolean(listingText[0]),
          hasResult1: Boolean(listingText[1]),
          hasResult2: Boolean(listingText[2]),
          city: incoming.city || "",
          suburb: incoming.suburb || "",
          property_category: incoming.property_category || "",
          property_type: incoming.property_type || "",
          bedrooms: incoming.bedrooms || "",
          min_price: Number(incoming.min_price || 0),
          max_price: Number(incoming.max_price || 0),
          q: incoming.q || "",
          cities: PREDEFINED_CITIES.map((c) => ({ id: c.id, title: c.title })),
        },
        layout: {
          type: "SingleColumnLayout",
          children: [
            { type: "TextSubheading", text: "${data.querySummary}" },
            {
              type: "TextBody",
              text: "${data.listingText0}\n\n${ data.listingText1 }\n\n${ data.listingText2 }",
            },
            {
              type: "Footer",
              label: "Done",
              "on-click-action": { name: "complete", payload: { status: "ok" } },
            },
          ],
        },
      },
    ],
  };
}

/* -------------------------
   detectRequestedScreen & helpers
   ------------------------- */
function detectRequestedScreen(rawPayload = {}, decryptedPayload = {}) {
  const checks = [
    rawPayload?.data_exchange?.screen,
    rawPayload?.flow?.screen,
    rawPayload?.screen,
    rawPayload?.action,
    rawPayload?.action?.payload?.screen,
    rawPayload?.entry?.[0]?.changes?.[0]?.value?.data_exchange?.screen,
    rawPayload?.entry?.[0]?.changes?.[0]?.value?.flow?.screen,
    decryptedPayload?.screen,
    decryptedPayload?.flow,
    decryptedPayload?.data?.screen,
    decryptedPayload?.data_exchange?.screen,
    decryptedPayload?.action?.payload?.screen,
    decryptedPayload?.data?.selected_city,
    decryptedPayload?.data?.city,
  ];
  for (const c of checks) {
    if (!c) continue;
    try {
      const s = String(c).trim();
      if (s) return s.toUpperCase();
    } catch (e) { }
  }
  return null;
}

function extractTimestamp(payload, messageBlock) {
  const candidates = [];
  if (payload?.timestamp) candidates.push(payload.timestamp);
  if (messageBlock?.timestamp) candidates.push(messageBlock.timestamp);
  if (messageBlock?.conversation_time) candidates.push(messageBlock.conversation_time);
  try {
    const msg = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] || payload?.messages?.[0] || messageBlock?.messages?.[0];
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
   POST handler (UNENCRYPTED flow only, resilient)
   ------------------------- */
export async function POST(request) {
  console.log("[webhook] POST invoked");

  // read raw body for optional signature verification and parsing
  let rawText = "";
  try {
    rawText = await request.text();
  } catch (e) {
    rawText = "";
  }

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
        // non-fatal: continue processing
      }
    }
  } catch (e) {
    console.warn("[webhook] signature validation error:", e);
  }

  console.log("[webhook] payload keys:", Object.keys(payload));

  // EARLY-EXIT: meta minimal deliveries (prevents 500s for simple pings)
  try {
    if (payload && payload.object && Array.isArray(payload.entry)) {
      const hasActionable = payload.entry.some((en) => {
        if (!en) return false;
        if (en.changes && en.changes.length) return true;
        if (en.messaging && en.messaging.length) return true;
        if (en.messages && en.messages.length) return true;
        if (en.changes?.some((c) => c?.value?.data_exchange || c?.value?.flow || c?.value?.messages)) return true;
        return false;
      });
      if (!hasActionable) {
        console.log("[webhook] no actionable entry — returning 200");
        return NextResponse.json({ ok: true, note: "no-actionable-entry" }, { status: 200 });
      }
    }
  } catch (e) {
    console.warn("[webhook] early-exit check error:", e);
    // continue processing
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

  // Normalize messageBlock and phone candidates
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

  // Parse text and handle interactive replies
  let parsedText =
    payload.user_message || (messageBlock && (messageBlock.text || messageBlock.body?.text || messageBlock.body?.plain)) || "";

  try {
    const incomingInteractive =
      payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.interactive ||
      messageBlock?.interactive;
    if (incomingInteractive && incomingInteractive.type === "button_reply") {
      parsedText = incomingInteractive?.button_reply?.id || incomingInteractive?.button_reply?.title || parsedText;
      console.log("[webhook] parsed interactive.button_reply:", parsedText);
    }
  } catch (e) { }

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

  // Save message only if DB available
  let savedMsg = null;
  try {
    if (dbAvailable && typeof Message?.create === "function") {
      savedMsg = await Message.create(incoming).catch((e) => {
        console.error("[webhook] save message error (create):", e);
        return null;
      });
    } else {
      console.log("[webhook] skipping Message.create because DB unavailable");
    }
  } catch (e) {
    console.error("[webhook] unexpected save message error:", e);
    savedMsg = null;
  }

  // Conversation routing
  try {
    const lastMeta = dbAvailable
      ? await (async () => {
        try {
          const doc = await Message.findOne({ phone: digitsOnly(phone), "meta.state": { $exists: true } }).sort({ createdAt: -1 }).lean().exec();
          return doc?.meta || null;
        } catch (e) {
          console.warn("[webhook] lastMeta lookup failed:", e);
          return null;
        }
      })()
      : null;

    // If user typed "search" directly (no active meta), ask for confirmation
    if (!lastMeta && /^search\b/i.test(parsedText || "")) {
      const confirmText = "Do you want to open the Search form now? Reply with Yes to continue or No to cancel.";
      if (dbAvailable) {
        await Message.create({
          phone: digitsOnly(phone),
          from: "system",
          type: "text",
          text: confirmText,
          meta: { state: "AWAITING_SEARCH_CONFIRMATION" },
        }).catch(() => null);
      }
      try {
        await sendInteractiveButtons(phone, confirmText, [
          { id: "confirm_search_yes", title: "Yes" },
          { id: "confirm_search_no", title: "No" },
        ]);
      } catch (e) {
        await sendText(phone, confirmText).catch(() => { });
      }
      return NextResponse.json({ ok: true, note: "asked-search-confirmation-direct" });
    }

    // If no lastMeta -> show menu
    if (!lastMeta) {
      const bodyText = "Welcome to CribMatch 👋 — choose an option:";
      const buttons = [
        { id: "menu_list", title: "List a property" },
        { id: "menu_search", title: "Search properties" },
        { id: "menu_purchases", title: "View my purchases" },
      ];
      if (dbAvailable) {
        await Message.create({
          phone: digitsOnly(phone),
          from: "system",
          type: "text",
          text: `${bodyText}\n1) List a property\n2) Search properties\n3) View my purchases\n\nReply with the number (e.g. 1) or the word (e.g. 'list').`,
          raw: null,
          meta: { state: "AWAITING_MENU_CHOICE" },
        }).catch(() => null);
      }
      await sendInteractiveButtons(phone, `${bodyText}\nTap a button or reply with a number`, buttons);
      return NextResponse.json({ ok: true, note: "menu-sent" });
    }

    // --- AWAITING_LIST_SELECTION
    if (lastMeta.state === "AWAITING_LIST_SELECTION") {
      const m = String(parsedText || "").trim();
      if (/^[1-9]\d*$/.test(m)) {
        const idx = parseInt(m, 10) - 1;
        const ids = lastMeta.listingIds || [];
        if (idx >= 0 && idx < ids.length) {
          const listingId = ids[idx];
          await revealContactDetails(listingId, phone);
          if (dbAvailable) {
            await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: `You selected ${m}. Contact details sent.`, meta: { state: "CONTACT_REVEALED", listingId } }).catch(() => { });
          } else {
            await sendText(phone, `You selected ${m}. Contact details sent.`).catch(() => { });
          }
          return NextResponse.json({ ok: true, note: "selection-handled" });
        } else {
          await sendText(phone, `Invalid selection. Reply with a number between 1 and ${ids.length}.`);
          return NextResponse.json({ ok: true, note: "selection-invalid" });
        }
      } else {
        await sendText(phone, "Please reply with the number of the listing (e.g. 1).");
        return NextResponse.json({ ok: true, note: "selection-expected-number" });
      }
    }

    // --- AWAITING_SEARCH_CONFIRMATION
    if (lastMeta.state === "AWAITING_SEARCH_CONFIRMATION") {
      const reply = String(parsedText || "").trim().toLowerCase();
      const positive = /^(yes|y|1|ok|sure|start|search|find)$/i;
      const negative = /^(no|n|cancel|stop|later|not now)$/i;

      if (positive.test(reply)) {
        if (dbAvailable) {
          await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: "Opening search form...", meta: { state: "FLOW_OPENED" } }).catch(() => null);
        }
        if (ENABLE_SEARCH_FLOW && DEFAULT_FLOW_ID) {
          await sendFlowStart(phone, DEFAULT_FLOW_ID, { selected_city: "harare" }).catch((e) => console.warn("sendFlowStart failed", e));
        } else {
          const fallbackText = "Search Flow is currently disabled — reply with area and budget (eg. Borrowdale, $200) or tap 'Search by message'.";
          await sendInteractiveButtons(phone, fallbackText, [{ id: "msg_search", title: "Search by message" }]).catch(() => { });
          await sendText(phone, "Or just type area and budget (eg. Borrowdale, $200) and I'll search for matches.");
        }
        return NextResponse.json({ ok: true, note: "search-confirmed-opened-flow" });
      } else if (negative.test(reply)) {
        if (dbAvailable) {
          await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: "Okay — search cancelled. What would you like to do next?", meta: { state: "AWAITING_MENU_CHOICE" } }).catch(() => null);
        }
        const buttons = [
          { id: "menu_list", title: "List a property" },
          { id: "menu_search", title: "Search properties" },
          { id: "menu_purchases", title: "View my purchases" },
        ];
        await sendInteractiveButtons(phone, "Choose an option:", buttons).catch(() => { });
        return NextResponse.json({ ok: true, note: "search-cancelled" });
      } else {
        await sendText(phone, "Please reply with Yes to open the search form, or No to cancel.").catch(() => { });
        return NextResponse.json({ ok: true, note: "search-confirmation-clarify" });
      }
    }

    // --- AWAITING_MENU_CHOICE
    if (lastMeta.state === "AWAITING_MENU_CHOICE") {
      const t = String(parsedText || "").trim().toLowerCase();
      if (/^\s*1\s*$/.test(t) || t.startsWith("list") || t === "menu_list") {
        if (dbAvailable) {
          await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: "Okay — let's list a property. What's the property title?", meta: { state: "LISTING_WAIT_TITLE", draft: {} } }).catch(() => null);
        }
        await sendText(phone, "Okay — let's list a property. What's the property title?");
        return NextResponse.json({ ok: true, note: "start-listing" });
      }

      if (/^\s*2\s*$/.test(t) || t.startsWith("search") || t === "menu_search") {
        const confirmText = "Do you want to open the Search form now? Reply with Yes to continue or No to cancel.";
        if (dbAvailable) {
          await Message.create({
            phone: digitsOnly(phone),
            from: "system",
            type: "text",
            text: confirmText,
            meta: { state: "AWAITING_SEARCH_CONFIRMATION" },
          }).catch(() => null);
        }
        try {
          await sendInteractiveButtons(phone, confirmText, [
            { id: "confirm_search_yes", title: "Yes" },
            { id: "confirm_search_no", title: "No" },
          ]);
        } catch (e) {
          await sendText(phone, confirmText).catch(() => { });
        }
        return NextResponse.json({ ok: true, note: "asked-search-confirmation" });
      }

      if (/^\s*3\s*$/.test(t) || t.startsWith("purchase") || t === "menu_purchases") {
        const purchasesPlaceholder = "You have 0 purchases. (This is a placeholder — wire your purchases DB.)";
        if (dbAvailable) {
          await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: purchasesPlaceholder, meta: { state: "SHOW_PURCHASES" } }).catch(() => null);
        }
        await sendText(phone, purchasesPlaceholder);
        return NextResponse.json({ ok: true, note: "show-purchases" });
      }

      await sendText(phone, "Sorry, I didn't understand. Reply with 1 (List), 2 (Search) or 3 (Purchases), or tap a button.");
      return NextResponse.json({ ok: true, note: "menu-repeat" });
    }

    // --- SEARCH_WAIT_AREA_BUDGET (text fallback)
    if (lastMeta.state === "SEARCH_WAIT_AREA_BUDGET") {
      const parts = parsedText.split(/[ ,\n]/).map((s) => s.trim()).filter(Boolean);
      const area = parts[0] || "";
      const budgetMatch = parsedText.match(/\$?(\d+(?:\.\d+)?)/);
      const budget = budgetMatch ? Number(budgetMatch[1]) : null;

      const results = await searchPublishedListings({ q: area, minPrice: null, maxPrice: budget, perPage: 6 });
      const msg = results.listings.length
        ? results.listings.map((l) => `${l.title} — ${l.suburb} — $${l.pricePerMonth} — ID:${l._id}`).join("\n\n")
        : "No matches found. Try a broader area or higher budget.";

      if (dbAvailable) {
        await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: msg, meta: { state: "SEARCH_RESULTS", query: { area, budget }, resultsCount: results.total } }).catch(() => { });
      }
      await sendText(phone, msg);

      if (results.listings && results.listings.length) {
        const top = results.listings.slice(0, 3);
        const buttons = top.map((l, i) => ({ id: `select_${l._id}`, title: `${l.title} — ${l.suburb} — $${l.pricePerMonth}` }));
        await sendInteractiveButtons(phone, "Tap a result to view contact details:", buttons).catch(() => { });
      }

      await sendText(phone, "To view contact details for any listing reply with: CONTACT <LISTING_ID> or tap the result.");
      return NextResponse.json({ ok: true, note: "search-results-sent" });
    }
  } catch (e) {
    console.warn("[webhook] conversation routing error:", e);
    // continue to safe default below
  }

  // Free-text reply window logic & default reply
  try {
    const windowMs = Number(process.env.WHATSAPP_FREE_WINDOW_MS) || 24 * 60 * 60 * 1000;
    let allowedToSend = false;
    const ts = extractTimestamp(payload, messageBlock);
    if (ts) {
      const age = Date.now() - ts;
      if (age <= windowMs) allowedToSend = true;
    } else {
      if (savedMsg) allowedToSend = true;
    }

    if (!allowedToSend) {
      if (dbAvailable && savedMsg) {
        await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.needsFollowUp": true } }).catch(() => { });
      }
      return NextResponse.json({ ok: true, note: "not-allowed-to-send-free-text-yet" });
    }

    const replyText = `Hi 👋 Welcome to CribMatch — tell me area and budget (eg. Borrowdale, $200) and I'll find matches.`;
    const sendResp = await sendText(phone, replyText);

    if (sendResp?.error) {
      if (dbAvailable && savedMsg) await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.sendError": sendResp } }).catch(() => { });
      const msg = String(sendResp?.error?.message || sendResp?.error || "");
      if (/24 hour|message template/i.test(msg)) {
        if (dbAvailable && savedMsg) await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.templateRequired": true, "meta.sendResp": sendResp } }).catch(() => { });
        return NextResponse.json({ ok: true, note: "send-rejected-24-hour", sendResp });
      }
      return NextResponse.json({ ok: false, error: sendResp }, { status: 500 });
    }

    if (dbAvailable && savedMsg) await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.sendResp": sendResp } }).catch(() => { });
    return NextResponse.json({ ok: true, savedMessageId: savedMsg?._id || null, sendResp });
  } catch (e) {
    console.error("[webhook] final reply error:", e);
    // respond 200 to avoid Meta retries — log the issue
    return NextResponse.json({ ok: true, note: "reply-error-logged" }, { status: 200 });
  }
}

// helper to reveal contact details
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
