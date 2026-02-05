// app/api/webhooks/whatsapp/route.js
import { NextResponse } from "next/server";
import { dbConnect, WebhookEvent, Listing } from "@/lib/db";
import Message from "@/lib/Message";
import { getListingById, searchPublishedListings } from "@/lib/getListings";
import crypto from "crypto";
import fs from "fs";

export const runtime = "nodejs";

// -------------------- Flow (encrypted) helpers --------------------
function loadPrivateKey() {
  // Prefer private key string in env (Vercel friendly). If that's not set, read file path.
  if (process.env.FLOW_PRIVATE_KEY && String(process.env.FLOW_PRIVATE_KEY).trim()) {
    // Replace literal \n sequences with real newlines if pasted escaped
    return String(process.env.FLOW_PRIVATE_KEY).replace(/\\n/g, "\n");
  }
  if (process.env.FLOW_PRIVATE_KEY_PATH && fs.existsSync(process.env.FLOW_PRIVATE_KEY_PATH)) {
    return fs.readFileSync(process.env.FLOW_PRIVATE_KEY_PATH, "utf8");
  }
  return null;
}

function rsaDecryptAesKey(encryptedAesKeyB64, privateKeyPem) {
  try {
    const encryptedBuf = Buffer.from(encryptedAesKeyB64, "base64");
    const aesKey = crypto.privateDecrypt(
      {
        key: privateKeyPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      encryptedBuf
    );
    return aesKey; // Buffer
  } catch (e) {
    throw new Error("rsa_decrypt_failed: " + (e.message || e));
  }
}

function aesGcmDecrypt(encryptedFlowDataB64, aesKeyBuf, ivB64) {
  try {
    const dataBuf = Buffer.from(encryptedFlowDataB64, "base64");
    // Tag is last 16 bytes
    if (dataBuf.length < 16) throw new Error("ciphertext_too_short");
    const tag = dataBuf.slice(dataBuf.length - 16);
    const ciphertext = dataBuf.slice(0, dataBuf.length - 16);
    const iv = Buffer.from(ivB64, "base64");

    const decipher = crypto.createDecipheriv("aes-128-gcm", aesKeyBuf, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString("utf8");
  } catch (e) {
    throw new Error("aes_decrypt_failed: " + (e.message || e));
  }
}

function aesGcmEncryptAndPack(plaintextBufOrStr, aesKeyBuf, ivBuf) {
  const iv = Buffer.isBuffer(ivBuf) ? ivBuf : Buffer.from(ivBuf, "base64");
  const cipher = crypto.createCipheriv("aes-128-gcm", aesKeyBuf, iv);
  const plaintextBuf = Buffer.isBuffer(plaintextBufOrStr) ? plaintextBufOrStr : Buffer.from(String(plaintextBufOrStr), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintextBuf), cipher.final()]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([encrypted, tag]).toString("base64");
  return combined;
}

// Flip IV for outgoing response (Meta Flow expects flipped IV)
function flipIv(ivBuf) {
  return Buffer.from(ivBuf).reverse();
}

async function handleFlowRequest(payload) {
  // payload contains encrypted_flow_data, encrypted_aes_key, initialization_vector
  const privateKey = loadPrivateKey();
  if (!privateKey) {
    console.error("[flow] missing private key");
    return { error: true, status: 500, body: { success: false, reason: "missing_flow_private_key" } };
  }

  const { encrypted_flow_data, encrypted_aes_key, initialization_vector } = payload || {};

  if (!encrypted_flow_data || !encrypted_aes_key || !initialization_vector) {
    return { error: true, status: 400, body: { success: false, reason: "missing_flow_fields" } };
  }

  let aesKeyBuf;
  try {
    aesKeyBuf = rsaDecryptAesKey(encrypted_aes_key, privateKey); // Buffer
  } catch (e) {
    console.error("[flow] rsa decrypt failed:", e.message || e);
    return { error: true, status: 400, body: { success: false, reason: "flow_rsa_decrypt_failed" } };
  }

  let decryptedJson;
  try {
    const plaintext = aesGcmDecrypt(encrypted_flow_data, aesKeyBuf, initialization_vector);
    decryptedJson = JSON.parse(plaintext);
  } catch (e) {
    console.error("[flow] aes decrypt or json parse failed:", e.message || e);
    return { error: true, status: 400, body: { success: false, reason: "flow_aes_decrypt_failed" } };
  }

  // Log decrypted Flow payload for visibility (avoid secrets)
  console.log("[flow] decrypted payload action:", decryptedJson?.action || null);

  // Now handle the decrypted flow message
  try {
    const action = (decryptedJson?.action || "").toString().toUpperCase();

    if (action === "INIT") {
      // Build dropdowns from Listing collection
      const suburbs = (await Listing.distinct("suburb")) || [];
      const propertyTypes = (await Listing.distinct("propertyType")) || [];
      const bedrooms = (await Listing.distinct("bedrooms")) || [];

      const responseScreen = {
        screen: "SEARCH",
        data: {
          suburbs: suburbs.filter(Boolean).slice(0, 200),
          propertyTypes: propertyTypes.filter(Boolean).slice(0, 200),
          bedrooms: bedrooms
            .filter((b) => b !== undefined && b !== null)
            .map((b) => String(b))
            .slice(0, 200),
        },
      };

      // Encrypt response using same aesKey but flipped IV
      const incomingIvBuf = Buffer.from(initialization_vector, "base64");
      const outgoingIvBuf = flipIv(incomingIvBuf);

      const encrypted_flow_data_resp = aesGcmEncryptAndPack(JSON.stringify(responseScreen), aesKeyBuf, outgoingIvBuf);
      return {
        error: false,
        status: 200,
        body: {
          encrypted_flow_data: encrypted_flow_data_resp,
          initialization_vector: outgoingIvBuf.toString("base64"),
        },
      };
    }

    if (action === "DATA_EXCHANGE" || action === "DATAEXCHANGE" || action === "DATA_EXCHANGE") {
      // decryptedJson.payload expected to contain search params
      const params = decryptedJson.payload || {};
      // Map to your search API
      const q = params.q || params.search || "";
      const suburb = params.suburb || params.suburbs || params.city || "";
      const min_price = Number(params.min_price ?? params.minPrice ?? params.minPriceCents ?? 0) || 0;
      const max_price = Number(params.max_price ?? params.maxPrice ?? params.maxPriceCents ?? 0) || null;
      const bedrooms = params.bedrooms ?? null;

      // Use your helper to search
      const results = await searchPublishedListings({
        q: suburb || q,
        minPrice: min_price || null,
        maxPrice: max_price || null,
        perPage: 6,
      });

      // Build results in the shape Flow UI expects (text0..2)
      const hits = (results?.listings || []).slice(0, 6).map((l) => ({
        text0: `${l.title || "Untitled"} — ${l.suburb || "N/A"} — $${l.pricePerMonth || 0}`,
        text1: `${l.bedrooms || 0} beds — ${l.propertyType || "Unknown"}`,
        text2: `ID:${l._id}`,
      }));

      const responsePayload = { results: hits };

      // Encrypt response with flipped IV
      const incomingIvBuf = Buffer.from(initialization_vector, "base64");
      const outgoingIvBuf = flipIv(incomingIvBuf);
      const encrypted_flow_data_resp = aesGcmEncryptAndPack(JSON.stringify(responsePayload), aesKeyBuf, outgoingIvBuf);

      return {
        error: false,
        status: 200,
        body: {
          encrypted_flow_data: encrypted_flow_data_resp,
          initialization_vector: outgoingIvBuf.toString("base64"),
        },
      };
    }

    // unknown action — respond with empty SEARCH screen
    const fallback = { screen: "SEARCH", data: { suburbs: [], propertyTypes: [], bedrooms: [] } };
    const incomingIvBuf = Buffer.from(initialization_vector, "base64");
    const outgoingIvBuf = flipIv(incomingIvBuf);
    const encrypted_flow_data_resp = aesGcmEncryptAndPack(JSON.stringify(fallback), aesKeyBuf, outgoingIvBuf);

    return {
      error: false,
      status: 200,
      body: {
        encrypted_flow_data: encrypted_flow_data_resp,
        initialization_vector: outgoingIvBuf.toString("base64"),
      },
    };
  } catch (e) {
    console.error("[flow] processing error:", e);
    return { error: true, status: 500, body: { success: false, reason: "flow_processing_error" } };
  }
}

// -------------------- End Flow helpers --------------------

// helpers
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

// interactive helpers (list and buttons)
async function sendInteractiveList(phoneNumber, { headerText, bodyText, footerText, buttonText, sections = [] }) {
  const apiToken = process.env.WHATSAPP_API_TOKEN || process.env.WHATCHIMP_API_KEY;
  const phone_number_id =
    process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATCHIMP_PHONE_ID || process.env.WHATCHIMP_PHONE_NUMBER_ID;
  if (!apiToken || !phone_number_id) return { error: "missing-credentials" };

  const payload = {
    messaging_product: "whatsapp",
    to: digitsOnly(phoneNumber),
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: String(bodyText || "") },
      action: {
        button: String(buttonText || "Choose"),
        sections,
      },
    },
  };

  if (headerText) payload.interactive.header = { type: "text", text: String(headerText) };
  if (footerText) payload.interactive.footer = { text: String(footerText) };

  const res = await whatsappPost(phone_number_id, apiToken, payload);

  if (res?.error) {
    // fallback to plain text menu
    const rows = (sections || []).flatMap((s) => s?.rows || []);
    const fallback = [
      bodyText,
      "",
      ...rows.map((r, i) => `${i + 1}) ${r.title}`),
      "",
      "Reply with the number (e.g. 1) or the word (e.g. 'list').",
    ]
      .filter(Boolean)
      .join("\n");
    await sendText(phoneNumber, fallback);
  }

  return res;
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
    // fallback
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

// simple retry helper
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

// ================= Conversation / Menu helpers =================
async function sendMenu(phone) {
  const bodyText = "Welcome to CribMatch 👋 — choose an option:";
  const rows = [
    { id: "menu_list", title: "List a property", description: "Post a rental listing" },
    { id: "menu_search", title: "Search properties", description: "Find rentals by area and budget" },
    { id: "menu_purchases", title: "View my purchases", description: "See paid contact unlocks" },
  ];

  // store system state message (only system messages are used to detect state)
  await Message.create({
    phone: digitsOnly(phone),
    from: "system",
    type: "text",
    text: `${bodyText}\n1) List a property\n2) Search properties\n3) View my purchases\n\nReply with the number (e.g. 1) or the word (e.g. 'list').`,
    raw: null,
    meta: { state: "AWAITING_MENU_CHOICE" },
  }).catch(() => null);

  // send interactive list (WhatsApp client shows this as a tappable list)
  await sendInteractiveList(phone, {
    headerText: "CribMatch",
    bodyText,
    footerText: "Tap an option or reply with 1, 2, or 3.",
    buttonText: "Choose",
    sections: [{ title: "Options", rows }],
  });
}

async function getLastConversationState(phone) {
  // IMPORTANT: only consider system messages for state (prevents user messages from hiding state)
  const doc = await Message.findOne({ phone: digitsOnly(phone), from: "system", "meta.state": { $exists: true } })
    .sort({ createdAt: -1 })
    .lean()
    .exec();
  return doc?.meta || null;
}

function getWhatsappIncomingMessage(payload, messageBlock) {
  return (
    payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] ||
    payload?.messages?.[0] ||
    messageBlock?.messages?.[0] ||
    null
  );
}

/**
 * Parse incoming text including interactive replies (button/list).
 */
function extractIncomingText(payload, messageBlock) {
  if (payload?.user_message) return String(payload.user_message);

  const direct =
    messageBlock && (messageBlock.text || messageBlock.body?.text || messageBlock.body?.plain || messageBlock.body);
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const waMsg = getWhatsappIncomingMessage(payload, messageBlock);
  if (!waMsg) return "";

  // text messages
  if (waMsg.type === "text" && typeof waMsg?.text?.body === "string") return waMsg.text.body.trim();

  // new interactive formats
  const interactive = waMsg?.interactive || messageBlock?.interactive || waMsg;
  if (interactive?.type === "button_reply" || interactive?.type === "button") {
    return String(interactive?.button_reply?.id || interactive?.button_reply?.title || waMsg?.button?.payload || waMsg?.button?.text || "").trim();
  }
  if (interactive?.type === "list_reply") {
    return String(interactive?.list_reply?.id || interactive?.list_reply?.title || "").trim();
  }

  if (waMsg.interactive?.type === "button_reply") {
    return String(waMsg.interactive.button_reply.id || waMsg.interactive.button_reply.title || "").trim();
  }
  if (waMsg.interactive?.type === "list_reply") {
    return String(waMsg.interactive.list_reply.id || waMsg.interactive.list_reply.title || "").trim();
  }

  if (typeof waMsg?.body === "string" && waMsg.body.trim()) return waMsg.body.trim();

  return "";
}

function interpretMenuChoice(text) {
  if (!text) return null;
  const t = String(text || "").trim().toLowerCase();
  const digit = (t.match(/[123]/) || [])[0] || "";

  if (digit === "1" || t.startsWith("list") || t === "menu_list") return "LIST";
  if (digit === "2" || t.startsWith("search") || t === "menu_search") return "SEARCH";
  if (digit === "3" || t.startsWith("purchase") || t === "menu_purchases") return "PURCHASES";
  return null;
}

// Minimal payment link creator placeholder (replace with real gateway)
async function createPaymentLink(phone, amountCents, description = "Contact details") {
  const fakeId = Date.now().toString(36);
  return {
    id: `pay_${fakeId}`,
    url: `https://payments.example.com/pay/${fakeId}?amount=${amountCents}&phone=${encodeURIComponent(phone)}`,
    amount: amountCents,
  };
}

async function revealContactDetails(listingId, phone) {
  const listing = await getListingById(listingId);
  if (!listing) {
    await sendText(phone, "Sorry — listing not found.");
    return;
  }

  const contactMessage = [
    `Contact info for "${listing.title}":`,
    `Name: ${listing.contactName || "N/A"}`,
    `Phone: ${listing.contactPhone || "N/A"}`,
    `WhatsApp: ${listing.contactWhatsApp || "N/A"}`,
    `Email: ${listing.contactEmail || "N/A"}`,
    "",
    "Note: address and exact location are not shared until meeting is arranged.",
  ].join("\n");

  await Message.create({
    phone: digitsOnly(phone),
    from: "system",
    type: "text",
    text: contactMessage,
    meta: { state: "CONTACT_REVEALED", listingId },
  }).catch(() => { });

  await sendText(phone, contactMessage);
}

// helper: simple heuristic whether a free-text message looks like "area and budget"
function looksLikeAreaBudget(text) {
  if (!text) return false;
  const hasWord = /\p{L}{2,}/u.test(text); // any word of 2+ letters
  const hasNumber = /[$]?\d{2,}/.test(text); // dollar or plain number
  return hasWord && hasNumber;
}

// timestamp helper
function extractTimestamp(payload, messageBlock) {
  const candidates = [];
  if (payload?.timestamp) candidates.push(payload.timestamp);
  if (messageBlock?.timestamp) candidates.push(messageBlock.timestamp);
  if (messageBlock?.conversation_time) candidates.push(messageBlock.conversation_time);
  try {
    const msg =
      payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] || payload?.messages?.[0] || messageBlock?.messages?.[0];
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

// ================= Webhook handlers =================
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

export async function POST(request) {
  console.log("[webhook] POST invoked");
  try {
    await dbConnect();
  } catch (err) {
    console.error("[webhook] DB connect failed", err);
    return NextResponse.json({ ok: false, error: "DB connect failed" }, { status: 500 });
  }

  // parse body
  let payload = {};
  try {
    payload = await request.json();
  } catch (err) {
    try {
      const t = await request.text();
      payload = t ? JSON.parse(t) : {};
    } catch (e) {
      payload = {};
    }
  }
  console.log("[webhook] payload keys:", Object.keys(payload));

  // Quick: if this is an encrypted Flow payload, handle and return encrypted response
  if (payload?.encrypted_flow_data || payload?.encrypted_aes_key || payload?.initialization_vector) {
    console.log("[webhook] detected encrypted Flow payload — attempting to decrypt");
    try {
      const flowResp = await handleFlowRequest(payload);
      if (flowResp.error) {
        console.warn("[webhook] flow handling failed", flowResp.body);
        return NextResponse.json(flowResp.body, { status: flowResp.status || 400 });
      }
      // success — return encrypted payload directly
      return NextResponse.json(flowResp.body, { status: 200 });
    } catch (e) {
      console.error("[webhook] flow handler threw:", e);
      return NextResponse.json({ success: false, reason: "flow_handler_exception" }, { status: 500 });
    }
  }

  // persist raw event (best-effort)
  try {
    const headersObj = Object.fromEntries(request.headers.entries());
    await WebhookEvent.create({ provider: "whatsapp", headers: headersObj, payload, receivedAt: new Date() });
  } catch (e) {
    console.warn("[webhook] save raw event failed:", e);
  }

  // normalize messageBlock (support multiple wrapper shapes)
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

  const waIncomingMsg = getWhatsappIncomingMessage(payload, messageBlock);

  const rawCandidates = [
    payload?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.wa_id,
    payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from,
    waIncomingMsg?.from,
    messageBlock?.from,
    payload.from,
    payload.chat_id,
    payload.subscriber_id ? String(payload.subscriber_id).split("-")[0] : null,
    payload.phone_number,
    messageBlock?.recipient,
  ].filter(Boolean);

  const phone = digitsOnly(rawCandidates[0] || "");

  // parse incoming text and interactive replies
  const parsedText = extractIncomingText(payload, messageBlock);
  console.log("[webhook] parsedText:", parsedText, "waType:", waIncomingMsg?.type || null);

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

  const savedMsg = await Message.create(incoming).catch((e) => {
    console.error("[webhook] save message error", e);
    return null;
  });

  // Conversation routing
  try {
    const lastMeta = await getLastConversationState(phone);
    console.log("[webhook] lastMeta:", lastMeta);

    // If there's no system state yet, show interactive menu
    if (!lastMeta) {
      await sendMenu(phone);
      await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.triggeredMenu": true } }).catch(() => { });
      return NextResponse.json({ ok: true, note: "menu-sent" });
    }

    // If waiting for menu choice, interpret the user's reply or button id
    if (lastMeta.state === "AWAITING_MENU_CHOICE") {
      const choice = interpretMenuChoice(parsedText);
      if (!choice) {
        console.log("[webhook] menu choice not understood", { parsedText });
        await sendText(phone, "Sorry, I didn't understand. Reply with 1 (List), 2 (Search) or 3 (Purchases), or tap a button.");
        // re-send interactive menu so client shows tappable options again
        await sendMenu(phone);
        return NextResponse.json({ ok: true, note: "menu-repeat" });
      }

      // To avoid race/loop: create a system message that updates the conversation state
      if (choice === "LIST") {
        const sys = await Message.create({
          phone: digitsOnly(phone),
          from: "system",
          type: "text",
          text: "Okay — let's list a property. What's the property title?",
          meta: { state: "LISTING_WAIT_TITLE", draft: {} },
        }).catch(() => null);

        await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.handledMenu": true } }).catch(() => { });
        await sendText(phone, "Okay — let's list a property. What's the property title?");
        return NextResponse.json({ ok: true, note: "start-listing", sysId: sys?._id || null });
      }

      if (choice === "SEARCH") {
        const sys = await Message.create({
          phone: digitsOnly(phone),
          from: "system",
          type: "text",
          text: "Tell me area and budget (eg: Borrowdale, $200).",
          meta: { state: "SEARCH_WAIT_AREA_BUDGET" },
        }).catch(() => null);

        await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.handledMenu": true } }).catch(() => { });
        await sendText(phone, "Tell me area and budget (eg: Borrowdale, $200).");
        return NextResponse.json({ ok: true, note: "start-search", sysId: sys?._id || null });
      }

      if (choice === "PURCHASES") {
        const purchasesPlaceholder = "You have 0 purchases. (This is a placeholder — wire your purchases DB.)";
        const sys = await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: purchasesPlaceholder, meta: { state: "SHOW_PURCHASES" } }).catch(() => null);
        await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.handledMenu": true } }).catch(() => { });
        await sendText(phone, purchasesPlaceholder);
        return NextResponse.json({ ok: true, note: "show-purchases", sysId: sys?._id || null });
      }
    }

    // Listing flow states
    if (lastMeta.state && lastMeta.state.startsWith("LISTING_WAIT_")) {
      const draftContainer = await Message.findOne({ phone: digitsOnly(phone), from: "system", "meta.draft": { $exists: true } }).sort({ createdAt: -1 }).exec();
      let draft = draftContainer?.meta?.draft || {};

      if (lastMeta.state === "LISTING_WAIT_TITLE") {
        draft.title = parsedText;
        const sys = await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: "Got it. What suburb is it in?", meta: { state: "LISTING_WAIT_SUBURB", draft } }).catch(() => null);
        await sendText(phone, "Got it. What suburb is it in?");
        return NextResponse.json({ ok: true, note: "listing-title-saved", sysId: sys?._id || null });
      }

      if (lastMeta.state === "LISTING_WAIT_SUBURB") {
        draft.suburb = parsedText;
        const sys = await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: "Property type (e.g. House, Apartment)?", meta: { state: "LISTING_WAIT_TYPE", draft } }).catch(() => null);
        await sendText(phone, "Property type (e.g. House, Apartment)?");
        return NextResponse.json({ ok: true, note: "listing-suburb-saved", sysId: sys?._id || null });
      }

      if (lastMeta.state === "LISTING_WAIT_TYPE") {
        draft.propertyType = parsedText;
        const sys = await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: "Monthly price (numbers only)?", meta: { state: "LISTING_WAIT_PRICE", draft } }).catch(() => null);
        await sendText(phone, "Monthly price (numbers only)?");
        return NextResponse.json({ ok: true, note: "listing-type-saved", sysId: sys?._id || null });
      }

      if (lastMeta.state === "LISTING_WAIT_PRICE") {
        const price = Number(parsedText.replace(/[^\d.]/g, "")) || 0;
        draft.pricePerMonth = price;
        const sys = await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: "How many bedrooms?", meta: { state: "LISTING_WAIT_BEDS", draft } }).catch(() => null);
        await sendText(phone, "How many bedrooms?");
        return NextResponse.json({ ok: true, note: "listing-price-saved", sysId: sys?._id || null });
      }

      if (lastMeta.state === "LISTING_WAIT_BEDS") {
        const beds = Math.max(0, parseInt(parsedText, 10) || 0);
        draft.bedrooms = beds;
        const sys = await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: "Add a short description or send 'skip'.", meta: { state: "LISTING_WAIT_DESC", draft } }).catch(() => null);
        await sendText(phone, "Add a short description or send 'skip'.");
        return NextResponse.json({ ok: true, note: "listing-beds-saved", sysId: sys?._id || null });
      }

      if (lastMeta.state === "LISTING_WAIT_DESC") {
        draft.description = parsedText && parsedText.toLowerCase() !== "skip" ? parsedText : "";
        const newListing = await Listing.create({
          title: draft.title || "Untitled",
          listerPhoneNumber: phone,
          suburb: draft.suburb || "",
          propertyType: draft.propertyType || "Unknown",
          pricePerMonth: draft.pricePerMonth || 0,
          bedrooms: draft.bedrooms || 0,
          description: draft.description || "",
          images: [],
          contactName: "",
          contactPhone: "",
          contactWhatsApp: "",
          contactEmail: "",
        }).catch((e) => {
          console.error("listing create failed", e);
          return null;
        });

        if (newListing) {
          const confirm = `Listing created: "${newListing.title}" — ID: ${newListing._id}\nTo add contact details or images, reply with "edit ${newListing._id}"`;
          await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: confirm, meta: { state: "LISTING_CREATED", listingId: newListing._id } }).catch(() => { });
          await sendText(phone, confirm);
        } else {
          await sendText(phone, "Failed to create listing — please try again later.");
        }
        return NextResponse.json({ ok: true, note: "listing-created" });
      }
    }

    // SEARCH flow
    if (lastMeta.state === "SEARCH_WAIT_AREA_BUDGET") {
      const parts = parsedText.split(/[ ,\n]/).map((s) => s.trim()).filter(Boolean);
      const area = parts[0] || "";
      const budgetMatch = parsedText.match(/\$?(\d+(?:\.\d+)?)/);
      const budget = budgetMatch ? Number(budgetMatch[1]) : null;

      const results = await searchPublishedListings({ q: area, minPrice: null, maxPrice: budget, perPage: 6 });
      const msg = results.listings.length
        ? results.listings.map((l) => `${l.title} — ${l.suburb} — $${l.pricePerMonth} — ID:${l._id}`).join("\n\n")
        : "No matches found. Try a broader area or higher budget.";

      await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: msg, meta: { state: "SEARCH_RESULTS", query: { area, budget }, resultsCount: results.total } }).catch(() => { });
      await sendText(phone, msg);
      await sendText(phone, "To view contact details for any listing reply with: CONTACT <LISTING_ID>");
      return NextResponse.json({ ok: true, note: "search-results-sent" });
    }

    // CONTACT flow
    if (/^contact\s+/i.test(parsedText || "")) {
      const listingId = (parsedText || "").split(/\s+/)[1];
      if (!listingId) {
        await sendText(phone, "Please reply with: CONTACT <listing-id>");
        return NextResponse.json({ ok: true, note: "contact-missing-id" });
      }

      const payment = await createPaymentLink(phone, 300, `Contact for listing ${listingId}`);
      await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: `Contact costs $3. Pay here: ${payment.url}`, meta: { state: "CONTACT_PAYMENT_PENDING", listingId, payment } }).catch(() => { });
      await sendText(phone, `Contact costs $3. Pay here: ${payment.url}\nAfter paying, reply with: PAID ${payment.id}`);
      return NextResponse.json({ ok: true, note: "contact-payment-requested" });
    }

    // PAID fallback
    if (/^paid\s+/i.test(parsedText || "")) {
      const paymentId = (parsedText || "").split(/\s+/)[1];
      if (!paymentId) {
        await sendText(phone, "Please reply with: PAID <payment-id>");
        return NextResponse.json({ ok: true, note: "paid-missing-id" });
      }

      const pend2 = await Message.findOne({ phone: digitsOnly(phone), "meta.state": "CONTACT_PAYMENT_PENDING" }).sort({ createdAt: -1 }).lean().exec();
      if (pend2) {
        await revealContactDetails(pend2.meta.listingId, phone);
        return NextResponse.json({ ok: true, note: "contact-revealed" });
      }

      await sendText(phone, "Could not find a pending payment / listing. Please try again.");
      return NextResponse.json({ ok: false, note: "payment-not-found" });
    }
  } catch (e) {
    console.warn("[webhook] conversation routing error:", e);
    // continue to fallback logic below
  }

  // Determine whether we are allowed to send free-text based on last user message timestamp
  const windowMs = Number(process.env.WHATSAPP_FREE_WINDOW_MS) || 24 * 60 * 60 * 1000;
  let allowedToSend = false;

  const ts = extractTimestamp(payload, messageBlock);
  if (ts) {
    const age = Date.now() - ts;
    console.log("[webhook] incoming message ageMs=", age);
    if (age <= windowMs) allowedToSend = true;
  } else {
    if (savedMsg) allowedToSend = true;
  }

  console.log("[webhook] allowedToSend =", allowedToSend);

  if (!allowedToSend) {
    await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.needsFollowUp": true } }).catch(() => { });
    return NextResponse.json({ ok: true, note: "not-allowed-to-send-free-text-yet" });
  }

  // If the user typed something that looks like "area + budget", handle it as search (so users typing directly work)
  if (looksLikeAreaBudget(extractIncomingText(payload, messageBlock))) {
    const text = extractIncomingText(payload, messageBlock);
    const parts = text.split(/[ ,\n]/).map((s) => s.trim()).filter(Boolean);
    const area = parts[0] || "";
    const budgetMatch = text.match(/\$?(\d+(?:\.\d+)?)/);
    const budget = budgetMatch ? Number(budgetMatch[1]) : null;

    const results = await searchPublishedListings({ q: area, minPrice: null, maxPrice: budget, perPage: 6 });
    const msg = results.listings.length
      ? results.listings.map((l) => `${l.title} — ${l.suburb} — $${l.pricePerMonth} — ID:${l._id}`).join("\n\n")
      : "No matches found. Try a broader area or higher budget.";

    await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: msg, meta: { state: "SEARCH_RESULTS", query: { area, budget }, resultsCount: results.total } }).catch(() => { });
    await sendText(phone, msg);
    await sendText(phone, "To view contact details for any listing reply with: CONTACT <LISTING_ID>");
    return NextResponse.json({ ok: true, note: "search-results-sent-direct" });
  }

  // otherwise: re-send interactive menu (safer than the old single-line "welcome" which caused loops)
  await sendMenu(phone);
  return NextResponse.json({ ok: true, note: "menu-resent" });
}
