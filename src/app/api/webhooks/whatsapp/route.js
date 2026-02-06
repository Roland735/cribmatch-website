// app/api/webhooks/whatsapp/route.js
import { NextResponse } from "next/server";
import crypto from "crypto";
import { dbConnect, WebhookEvent, Listing } from "@/lib/db";
import Message from "@/lib/Message";
import { getListingById, searchPublishedListings } from "@/lib/getListings";

export const runtime = "nodejs";

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

  // If interactive failed, fallback to text menu
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

// ================= Crypto helpers for Flow encryption =================
//
// RSA-OAEP SHA-256 to decrypt AES key, AES-GCM to decrypt/encrypt payload.
// Response encryption: AES-GCM using the bitwise-NOT (flipped) IV per docs.
//
function rsaDecryptAesKey(encryptedAesKeyB64, privateKeyPem) {
  const encryptedKeyBuf = Buffer.from(encryptedAesKeyB64, "base64");
  const aesKey = crypto.privateDecrypt(
    {
      key: privateKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    encryptedKeyBuf
  );
  return aesKey; // Buffer
}

function aesGcmDecrypt(encryptedFlowDataB64, aesKeyBuffer, ivB64) {
  const flowBuf = Buffer.from(encryptedFlowDataB64, "base64");
  const iv = Buffer.from(ivB64, "base64");
  const TAG_LENGTH = 16;
  if (flowBuf.length < TAG_LENGTH) throw new Error("encrypted flow data too short");
  const ciphertext = flowBuf.slice(0, flowBuf.length - TAG_LENGTH);
  const tag = flowBuf.slice(flowBuf.length - TAG_LENGTH);

  const alg = `aes-${aesKeyBuffer.length * 8}-gcm`;
  const decipher = crypto.createDecipheriv(alg, aesKeyBuffer, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return { plaintext: plaintext.toString("utf8"), aesIv: iv };
}

function aesGcmEncryptAndEncode(responseObj, aesKeyBuffer, requestIvBuffer) {
  // flip IV bits (bitwise NOT) as required by docs
  const flippedIv = Buffer.alloc(requestIvBuffer.length);
  for (let i = 0; i < requestIvBuffer.length; i++) flippedIv[i] = (~requestIvBuffer[i]) & 0xff;

  const alg = `aes-${aesKeyBuffer.length * 8}-gcm`;
  const cipher = crypto.createCipheriv(alg, aesKeyBuffer, flippedIv);
  const plainBuf = Buffer.from(JSON.stringify(responseObj), "utf8");
  const encrypted = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
  const tag = cipher.getAuthTag();
  const out = Buffer.concat([encrypted, tag]);
  return out.toString("base64");
}

// ================= Flow response builders ================

function buildResultsFlowResponse(screen = "RESULTS", incoming = {}) {
  return {
    version: "3.0",
    screen: screen,
    data: {
      resultsCount: 0,
      listings: [],
      querySummary: "",
      listingText0: "",
      listingText1: "",
      listingText2: "",
      hasResult0: false,
      hasResult1: false,
      hasResult2: false,
      city: incoming.city || "",
      suburb: incoming.suburb || "",
      property_category: incoming.property_category || "",
      property_type: incoming.property_type || "",
      bedrooms: incoming.bedrooms || "",
      min_price: Number(incoming.min_price || 0),
      max_price: Number(incoming.max_price || 0),
      q: incoming.q || "",
      cities: [],
      suburbs: [],
      propertyCategories: [],
      propertyTypes: [],
      bedrooms_list: [],
      min_price_default: 0,
      max_price_default: 0,
      query: "",
      refine: false,
    },
  };
}

function buildSearchSchemaFlowResponse() {
  return {
    version: "7.3",
    data_api_version: "3.0",
    routing_model: {
      SEARCH: ["RESULTS"],
      RESULTS: ["COMPLETE"],
      COMPLETE: [],
    },
    screens: [
      {
        id: "SEARCH",
        title: "Find rentals near you",
        data: {
          cities: { type: "array", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" } } }, "__example__": [] },
          suburbs: { type: "array", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" } } }, "__example__": [] },
          propertyCategories: { type: "array", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" } } }, "__example__": [] },
          propertyTypes: { type: "array", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" } } }, "__example__": [] },
          bedrooms: { type: "array", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" } } }, "__example__": [] },
          min_price: { type: "number", "__example__": 0 },
          max_price: { type: "number", "__example__": 0 },
          query: { type: "string", "__example__": "" },
          selected_city: { type: "string", "__example__": "" },
          selected_suburb: { type: "string", "__example__": "" },
          selected_category: { type: "string", "__example__": "" },
          selected_type: { type: "string", "__example__": "" },
          selected_bedrooms: { type: "string", "__example__": "" },
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
                q: "${data.query}",
              },
              children: [
                { type: "Image", src: "/9j/4AAQSkZJRgABAQAAAQABAAD...search-hero-base64...==", height: 108, "scale-type": "cover" },
                { type: "TextSubheading", text: "Find rentals fast" },
                { type: "TextBody", text: "Tell us where and what you want — tap fields or type keywords (eg: Borrowdale, $200)." },
                { type: "Dropdown", label: "City", required: true, name: "city", "data-source": "${data.cities}", "on-select-action": { name: "data_exchange", payload: { selected_city: "${form.city}" } } },
                { type: "Dropdown", label: "Suburb (optional)", required: false, name: "suburb", "data-source": "${data.suburbs}", "on-select-action": { name: "data_exchange", payload: { selected_suburb: "${form.suburb}" } } },
                { type: "Dropdown", label: "Category", required: false, name: "property_category", "data-source": "${data.propertyCategories}", "on-select-action": { name: "data_exchange", payload: { selected_category: "${form.property_category}" } } },
                { type: "Dropdown", label: "Property type", required: false, name: "property_type", "data-source": "${data.propertyTypes}", "on-select-action": { name: "data_exchange", payload: { selected_type: "${form.property_type}" } } },
                { type: "Dropdown", label: "Bedrooms", required: false, name: "bedrooms", "data-source": "${data.bedrooms}", "on-select-action": { name: "data_exchange", payload: { selected_bedrooms: "${form.bedrooms}" } } },
                { type: "TextInput", label: "Min monthly rent (numbers only)", name: "min_price", required: false, "input-type": "number" },
                { type: "TextInput", label: "Max monthly rent (numbers only)", name: "max_price", required: false, "input-type": "number" },
                { type: "TextInput", label: "Keywords (optional)", name: "q", required: false, "input-type": "text" },
                { type: "Footer", label: "Search", "on-click-action": { name: "data_exchange", payload: { city: "${form.city}", suburb: "${form.suburb}", property_category: "${form.property_category}", property_type: "${form.property_type}", bedrooms: "${form.bedrooms}", min_price: "${form.min_price}", max_price: "${form.max_price}", q: "${form.q}" } } },
              ],
            },
          ],
        },
      },
      {
        id: "RESULTS",
        title: "Search results",
        data: {
          resultsCount: { type: "number", "__example__": 0 },
          listings: { type: "array", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, suburb: { type: "string" }, pricePerMonth: { type: "number" }, bedrooms: { type: "string" } } }, "__example__": [] },
          querySummary: { type: "string", "__example__": "" },
          listingText0: { type: "string", "__example__": "" },
          listingText1: { type: "string", "__example__": "" },
          listingText2: { type: "string", "__example__": "" },
          hasResult0: { type: "boolean", "__example__": false },
          hasResult1: { type: "boolean", "__example__": false },
          hasResult2: { type: "boolean", "__example__": false },
        },
        layout: {
          type: "SingleColumnLayout",
          children: [
            {
              type: "Form",
              name: "results_view",
              children: [
                { type: "TextSubheading", text: "Results" },
                { type: "TextBody", text: "Found ${data.resultsCount} matching listings." },
                { type: "TextBody", text: "${data.querySummary}" },
                { type: "TextBody", text: "${data.listingText0}", visible: "${data.hasResult0}" },
                { type: "TextBody", text: "${data.listingText1}", visible: "${data.hasResult1}" },
                { type: "TextBody", text: "${data.listingText2}", visible: "${data.hasResult2}" },
                { type: "TextBody", text: "To view contact details for any listing, reply with: CONTACT <LISTING_ID> in the chat or use the chat to request more details." },
                { type: "Footer", label: "Refine search", "on-click-action": { name: "data_exchange", payload: { refine: "true" } } },
              ],
            },
          ],
        },
      },
      {
        id: "COMPLETE",
        title: "Search sent",
        data: {},
        terminal: true,
        layout: {
          type: "SingleColumnLayout",
          children: [
            {
              type: "Form",
              name: "flow_complete",
              children: [
                { type: "TextSubheading", text: "All set!" },
                { type: "TextBody", text: "We've run the search and sent the results. Reply with a listing ID to view contact details or start a new search any time." },
                { type: "Footer", label: "Done", "on-click-action": { name: "complete", payload: {} } },
              ],
            },
          ],
        },
      },
    ],
  };
}

// Robust helper to determine the requested flow screen from either raw payload or decrypted payload
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
    decryptedPayload?.flow?.screen,
    decryptedPayload?.data?.screen,
    decryptedPayload?.data_exchange?.screen,
    decryptedPayload?.action?.payload?.screen,
    decryptedPayload?.data?.selected_screen,
  ];
  for (const c of checks) {
    if (!c) continue;
    try {
      const s = String(c).trim();
      if (s) return s.toUpperCase();
    } catch (e) {
      // ignore
    }
  }
  return null;
}

// ================= Conversation / Menu helpers =================
async function sendMenu(phone) {
  const bodyText = "Welcome to CribMatch 👋 — choose an option:";
  const buttons = [
    { id: "menu_list", title: "List a property" },
    { id: "menu_search", title: "Search properties" },
    { id: "menu_purchases", title: "View my purchases" },
  ];

  await Message.create({
    phone: digitsOnly(phone),
    from: "system",
    type: "text",
    text: `${bodyText}\n1) List a property\n2) Search properties\n3) View my purchases\n\nReply with the number (e.g. 1) or the word (e.g. 'list').`,
    raw: null,
    meta: { state: "AWAITING_MENU_CHOICE" },
  }).catch(() => null);

  await sendInteractiveButtons(phone, `${bodyText}\nTap a button or reply with a number`, buttons);
}

async function getLastConversationState(phone) {
  const doc = await Message.findOne({ phone: digitsOnly(phone), "meta.state": { $exists: true } })
    .sort({ createdAt: -1 })
    .lean()
    .exec();
  return doc?.meta || null;
}

function interpretMenuChoice(text) {
  if (!text) return null;
  const t = String(text || "").trim().toLowerCase();

  if (/^\s*1\s*$/.test(t) || t.startsWith("list") || t.includes("list a") || t === "menu_list") return "LIST";
  if (/^\s*2\s*$/.test(t) || t.startsWith("search") || t.includes("search") || t === "menu_search") return "SEARCH";
  if (/^\s*3\s*$/.test(t) || t.startsWith("purchase") || t.includes("purchase") || t.includes("orders") || t === "menu_purchases") return "PURCHASES";
  return null;
}

// Minimal payment link creator placeholder (replace with Stripe/Payfast)
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

// ================= Timestamp extraction helper =================
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

  // parse body (robust)
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

  // ------------------------------
  // Flow detection & fast-response (handle encrypted and unencrypted data exchange)
  // ------------------------------
  try {
    const hasDataExchange = Boolean(payload?.data_exchange);
    const hasEncrypted = Boolean(payload?.encrypted_flow_data && payload?.encrypted_aes_key && payload?.initial_vector);
    const hasFlowWrapper = Boolean(payload?.flow);
    const mayBeFlowViaEntry =
      Boolean(payload?.entry?.[0]?.changes?.[0]?.value?.flow) ||
      Boolean(payload?.entry?.[0]?.changes?.[0]?.value?.data_exchange) ||
      Boolean(payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.type === "flow");

    const isFlowRequest = hasDataExchange || hasEncrypted || hasFlowWrapper || mayBeFlowViaEntry;

    if (isFlowRequest) {
      console.log("[webhook] detected flow request - handling data exchange / healthcheck");

      // Health check ping
      if (payload?.action === "ping" || payload?.action === "PING") {
        const healthResp = { data: { status: "active" } };
        if (hasEncrypted) {
          try {
            const privateKeyPem = process.env.FLOW_PRIVATE_KEY || process.env.PRIVATE_KEY;
            if (!privateKeyPem) {
              console.error("[webhook] FLOW_PRIVATE_KEY missing for encrypted healthcheck");
              return NextResponse.json({ error: "private key missing" }, { status: 500 });
            }
            const aesKeyBuffer = rsaDecryptAesKey(payload.encrypted_aes_key, privateKeyPem);
            const ivBuf = Buffer.from(payload.initial_vector, "base64");
            const encryptedRespBase64 = aesGcmEncryptAndEncode(healthResp, aesKeyBuffer, ivBuf);
            return new Response(encryptedRespBase64, {
              status: 200,
              headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
            });
          } catch (e) {
            console.error("[webhook] healthcheck encrypted response error", e);
            return NextResponse.json({ error: "health encrypt failed" }, { status: 500 });
          }
        } else {
          const respJson = JSON.stringify({ version: "3.0", screen: "RESULTS", data: healthResp.data });
          const respBase64 = Buffer.from(respJson, "utf8").toString("base64");
          return new Response(respBase64, {
            status: 200,
            headers: { "Content-Type": "application/octet-stream", "Content-Transfer-Encoding": "base64", "Cache-Control": "no-store" },
          });
        }
      }

      // Encrypted path
      if (hasEncrypted) {
        try {
          const privateKeyPem = process.env.FLOW_PRIVATE_KEY || process.env.PRIVATE_KEY;
          if (!privateKeyPem) {
            console.error("[webhook] FLOW_PRIVATE_KEY env var not set");
            return NextResponse.json({ error: "private key missing" }, { status: 500 });
          }

          const aesKeyBuffer = rsaDecryptAesKey(payload.encrypted_aes_key, privateKeyPem);
          const { plaintext: decryptedText, aesIv } = aesGcmDecrypt(payload.encrypted_flow_data, aesKeyBuffer, payload.initial_vector);

          console.log("[webhook] decrypted flow payload:", decryptedText);
          let decryptedPayload;
          try {
            decryptedPayload = JSON.parse(decryptedText);
          } catch (e) {
            decryptedPayload = { data: {} };
          }

          const requestedScreen = detectRequestedScreen(payload, decryptedPayload) || "RESULTS";
          console.log("[webhook] detected requestedScreen:", requestedScreen);

          if (requestedScreen === "SEARCH") {
            const flowResponse = buildSearchSchemaFlowResponse();
            const encryptedRespBase64 = aesGcmEncryptAndEncode(flowResponse, aesKeyBuffer, aesIv);
            return new Response(encryptedRespBase64, {
              status: 200,
              headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
            });
          } else {
            const flowResponse = buildResultsFlowResponse("RESULTS", decryptedPayload?.data || {});
            const encryptedRespBase64 = aesGcmEncryptAndEncode(flowResponse, aesKeyBuffer, aesIv);
            return new Response(encryptedRespBase64, {
              status: 200,
              headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
            });
          }
        } catch (e) {
          console.error("[webhook] flow encrypted handling error:", e);
          return NextResponse.json({ ok: false, error: "flow-encrypt-handling-failed" }, { status: 500 });
        }
      }

      // Unencrypted flow / data_exchange path
      if (hasDataExchange || hasFlowWrapper || mayBeFlowViaEntry) {
        const screenFromRequest = (payload?.data_exchange?.screen || payload?.flow?.screen || payload?.screen || "RESULTS");
        const incomingData = payload?.data_exchange?.data || payload?.data || {};

        const requestedScreen = detectRequestedScreen(payload, {}) || String(screenFromRequest || "RESULTS").toUpperCase();
        console.log("[webhook] unencrypted requestedScreen:", requestedScreen);

        if (requestedScreen === "SEARCH") {
          const flowResponse = buildSearchSchemaFlowResponse();
          const flowResponseJson = JSON.stringify(flowResponse);
          const flowResponseBase64 = Buffer.from(flowResponseJson, "utf8").toString("base64");
          return new Response(flowResponseBase64, {
            status: 200,
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Transfer-Encoding": "base64",
              "Cache-Control": "no-store",
            },
          });
        } else {
          const flowResponse = buildResultsFlowResponse(screenFromRequest, incomingData);
          const flowResponseJson = JSON.stringify(flowResponse);
          const flowResponseBase64 = Buffer.from(flowResponseJson, "utf8").toString("base64");
          return new Response(flowResponseBase64, {
            status: 200,
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Transfer-Encoding": "base64",
              "Cache-Control": "no-store",
            },
          });
        }
      }
    }
  } catch (e) {
    console.error("[webhook] flow-detect/response error", e);
    // fall through to normal processing if detection fails
  }

  // ------------------------------
  // Non-flow processing (normal webhook)
  // ------------------------------
  try {
    await dbConnect();
  } catch (err) {
    console.error("[webhook] DB connect failed", err);
    return NextResponse.json({ ok: false, error: "DB connect failed" }, { status: 500 });
  }

  // persist raw event (best-effort)
  try {
    const headersObj = Object.fromEntries(request.headers.entries());
    await WebhookEvent.create({ provider: "whatsapp", headers: headersObj, payload, receivedAt: new Date() });
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

  // Parse text and also handle interactive button replies
  let parsedText =
    payload.user_message || (messageBlock && (messageBlock.text || messageBlock.body?.text || messageBlock.body?.plain)) || "";

  // If incoming payload contains interactive button reply, prefer its id/title
  try {
    const incomingInteractive =
      payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.interactive ||
      messageBlock?.interactive;
    if (incomingInteractive && incomingInteractive.type === "button_reply") {
      parsedText = incomingInteractive?.button_reply?.id || incomingInteractive?.button_reply?.title || parsedText;
      console.log("[webhook] parsed interactive.button_reply:", parsedText);
    }
  } catch (e) {
    // ignore
  }

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

    // If there's no state yet, show menu
    if (!lastMeta) {
      await sendMenu(phone);
      await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.triggeredMenu": true } }).catch(() => { });
      return NextResponse.json({ ok: true, note: "menu-sent" });
    }

    // If waiting for menu choice, interpret the user's reply or button id
    if (lastMeta.state === "AWAITING_MENU_CHOICE") {
      const choice = interpretMenuChoice(parsedText);
      if (!choice) {
        await sendText(phone, "Sorry, I didn't understand. Reply with 1 (List), 2 (Search) or 3 (Purchases), or tap a button.");
        return NextResponse.json({ ok: true, note: "menu-repeat" });
      }

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

    // Listing flow (states)
    if (lastMeta.state && lastMeta.state.startsWith("LISTING_WAIT_")) {
      const draftContainer = await Message.findOne({ phone: digitsOnly(phone), "meta.draft": { $exists: true } }).sort({ createdAt: -1 }).exec();
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

    // Search flow
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

    // PAID fallback (rudimentary)
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
    // continue to existing free-text/send logic below
  }

  // Determine whether we are allowed to send free-text based on last user message timestamp
  const windowMs = Number(process.env.WHATSAPP_FREE_WINDOW_MS) || 24 * 60 * 60 * 1000;
  let allowedToSend = false;

  const ts = extractTimestamp(payload, messageBlock);
  if (ts) {
    const age = Date.now() - ts;
    console.log(`[webhook] incoming message ageMs=${age}`);
    if (age <= windowMs) allowedToSend = true;
  } else {
    if (savedMsg) allowedToSend = true;
  }

  console.log("[webhook] allowedToSend =", allowedToSend);

  if (!allowedToSend) {
    await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.needsFollowUp": true } }).catch(() => { });
    return NextResponse.json({ ok: true, note: "not-allowed-to-send-free-text-yet" });
  }

  // If allowed, attempt the free-text send using Graph API
  const replyText = `Hi 👋 Welcome to CribMatch — tell me area and budget (eg. Borrowdale, $200) and I'll find matches.`;
  const sendResp = await sendText(phone, replyText);
  console.log("[webhook] sendText response:", sendResp);

  if (sendResp?.error) {
    await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.sendError": sendResp } }).catch(() => { });
    const msg = String(sendResp?.error?.message || sendResp?.error || "");
    if (/24 hour|message template/i.test(msg)) {
      await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.templateRequired": true, "meta.sendResp": sendResp } }).catch(() => { });
      return NextResponse.json({ ok: true, note: "send-rejected-24-hour", sendResp });
    }
    return NextResponse.json({ ok: false, error: sendResp }, { status: 500 });
  }

  await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.sendResp": sendResp } }).catch(() => { });
  return NextResponse.json({ ok: true, savedMessageId: savedMsg?._id || null, sendResp });
}
