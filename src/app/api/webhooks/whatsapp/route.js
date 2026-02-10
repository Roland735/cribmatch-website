// app/api/webhooks/whatsapp/route.js
import { NextResponse } from "next/server";
import crypto from "crypto";
import { dbConnect, WebhookEvent, Listing } from "@/lib/db";
import Message from "@/lib/Message";
import { getListingById, searchPublishedListings } from "@/lib/getListings";
import seedListings from "./seedListings.json"; // make sure this file exists next to this route

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
   Send flow helper
   ------------------------- */
const DEFAULT_FLOW_ID = process.env.WHATSAPP_FLOW_ID || "1534021024566343";

async function sendFlowStart(phoneNumber, flowId = DEFAULT_FLOW_ID, data = {}) {
  const apiToken = process.env.WHATSAPP_API_TOKEN || process.env.WHATCHIMP_API_KEY;
  const phone_number_id =
    process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATCHIMP_PHONE_ID || process.env.WHATCHIMP_PHONE_NUMBER_ID;
  if (!apiToken || !phone_number_id) return { error: "missing-credentials" };

  // ensure some minimal arrays so dropdowns render
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
    // merge in any selected_* values passed
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
   Crypto helpers (RSA-OAEP SHA256 + AES-GCM)
   ------------------------- */
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
  // flip IV bits (bitwise NOT)
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

/* -------------------------
   Predefined cities & seed listings helper
   ------------------------- */
const PREDEFINED_CITIES = [
  { id: "harare", title: "Harare" },
  { id: "bulawayo", title: "Bulawayo" },
  { id: "mutare", title: "Mutare" },
];

function getSeedListingsForCity(cityIdOrTitle) {
  const q = String(cityIdOrTitle || "").trim().toLowerCase();
  const found = (seedListings || []).filter((s) => {
    if (!s.city) return false;
    const c = String(s.city).toLowerCase();
    return c.includes(q) || s.city.toLowerCase() === q || (s.cityId && String(s.cityId).toLowerCase() === q);
  });
  return found.slice(0, 3);
}

/* -------------------------
   Flow response builders (single SEARCH screen + RESULTS)
   ------------------------- */
function buildSearchSchemaFlowResponse() {
  // Return the SEARCH screen JSON you supplied (version 7.3)
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
    .map((l, i) => `${i + 1}) ${l.title} — ${l.suburb || ""} — $${l.pricePerMonth || l.price || "N/A"} — ID:${l.id || l._id || i}`)
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
            id: l.id || l._id || "",
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
              type: "TextBody", text: "${data.listingText0}\n\n${ data.listingText1 }\n\n${ data.listingText2 }",
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
   detectRequestedScreen
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
    decryptedPayload?.flow?.screen,
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

/* -------------------------
   Timestamp extraction helper
   ------------------------- */
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
   GET handler (verify webhook)
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
   POST handler (full)
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

  // Optional signature validation
  try {
    const appSecret = process.env.APP_SECRET;
    const sigHeader = request.headers.get("x-hub-signature-256") || request.headers.get("X-Hub-Signature-256");
    if (appSecret && sigHeader) {
      const expectedSig = sigHeader.startsWith("sha256=") ? sigHeader.slice(7) : sigHeader;
      const hmac = crypto.createHmac("sha256", appSecret).update(rawText).digest("hex");
      if (!crypto.timingSafeEqual(Buffer.from(expectedSig, "hex"), Buffer.from(hmac, "hex"))) {
        console.warn("[webhook] signature validation failed");
        return new Response("Invalid signature", { status: 403 });
      }
    }
  } catch (e) {
    console.warn("[webhook] signature validation error:", e);
  }

  console.log("[webhook] payload keys:", Object.keys(payload));

  // Flow detection
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
      console.log("[webhook] detected flow request");

      // Health check
      const actionVal = (payload?.action || "").toString().toLowerCase();
      if (actionVal === "ping") {
        const healthBody = { data: { status: "active" } };
        if (hasEncrypted) {
          try {
            const privateKeyPem = process.env.FLOW_PRIVATE_KEY || process.env.PRIVATE_KEY;
            if (!privateKeyPem) return NextResponse.json({ error: "private key missing" }, { status: 500 });
            const aesKeyBuffer = rsaDecryptAesKey(payload.encrypted_aes_key, privateKeyPem);
            const ivBuf = Buffer.from(payload.initial_vector, "base64");
            const encryptedRespBase64 = aesGcmEncryptAndEncode(healthBody, aesKeyBuffer, ivBuf);
            return new Response(encryptedRespBase64, { status: 200, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
          } catch (e) {
            console.error("[webhook] health encrypted response error:", e);
            return NextResponse.json({ error: "health encrypt failed" }, { status: 500 });
          }
        } else {
          return NextResponse.json(healthBody, { status: 200 });
        }
      }

      // ENCRYPTED flow path
      if (hasEncrypted) {
        try {
          const privateKeyPem = process.env.FLOW_PRIVATE_KEY || process.env.PRIVATE_KEY;
          if (!privateKeyPem) return NextResponse.json({ error: "private key missing" }, { status: 500 });

          const aesKeyBuffer = rsaDecryptAesKey(payload.encrypted_aes_key, privateKeyPem);

          // If encrypted_flow_data exists — decrypt and inspect
          if (payload.encrypted_flow_data) {
            const { plaintext: decryptedText, aesIv } = aesGcmDecrypt(payload.encrypted_flow_data, aesKeyBuffer, payload.initial_vector);
            console.log("[webhook] decrypted flow payload:", decryptedText);
            let decryptedPayload = {};
            try {
              decryptedPayload = JSON.parse(decryptedText);
            } catch (e) {
              decryptedPayload = { data: {} };
            }

            // see if this is a SEARCH request or selection
            const requestedScreen = detectRequestedScreen(payload, decryptedPayload) || "RESULTS";
            console.log("[webhook] requestedScreen (decrypted):", requestedScreen);

            // extract phone if present in the entry or decrypted payload (flow requests often include contacts)
            const phoneCandidate = (
              payload?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.wa_id ||
              decryptedPayload?.data?.wa_id ||
              decryptedPayload?.data?.from
            ) || null;
            const phone = phoneCandidate ? digitsOnly(String(phoneCandidate)) : null;

            // If the request is asking for the SEARCH screen, return the single-screen SEARCH schema
            if (requestedScreen === "SEARCH") {
              const flowResponse = buildSearchSchemaFlowResponse();
              const encryptedRespBase64 = aesGcmEncryptAndEncode(flowResponse, aesKeyBuffer, aesIv);
              return new Response(encryptedRespBase64, { status: 200, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
            }

            // If decrypted payload includes selected_city (user selected a city)
            const selectedCity = decryptedPayload?.data?.selected_city || decryptedPayload?.data?.city || decryptedPayload?.data?.city_id || null;
            if (selectedCity) {
              // get seed listings
              const listings = getSeedListingsForCity(selectedCity);
              const flowResponse = buildResultsFlowResponseForListings(listings, { city: selectedCity });

              // store an AWATING_LIST_SELECTION system message for phone (if we have one)
              if (phone) {
                const listingIds = listings.map((l) => l.id || l._id || "");
                await Message.create({
                  phone: digitsOnly(phone),
                  from: "system",
                  type: "text",
                  text: `Found ${listings.length} listings for ${selectedCity}. Reply with the number (1-${listings.length}) to choose.`,
                  meta: { state: "AWAITING_LIST_SELECTION", listingIds },
                }).catch(() => { });
              }

              const encryptedRespBase64 = aesGcmEncryptAndEncode(flowResponse, aesKeyBuffer, aesIv);
              return new Response(encryptedRespBase64, { status: 200, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
            }

            // No selected city & not SEARCH -> just reply with empty RESULTS (safe default)
            const emptyResp = buildResultsFlowResponseForListings([], {});
            const encryptedRespBase64 = aesGcmEncryptAndEncode(emptyResp, aesKeyBuffer, aesIv);
            return new Response(encryptedRespBase64, { status: 200, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
          } else {
            // encrypted without encrypted_flow_data -> respond with SEARCH schema encrypted using IV
            const ivBuf = Buffer.from(payload.initial_vector, "base64");
            const flowResponse = buildSearchSchemaFlowResponse();
            const encryptedRespBase64 = aesGcmEncryptAndEncode(flowResponse, aesKeyBuffer, ivBuf);
            return new Response(encryptedRespBase64, { status: 200, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
          }
        } catch (e) {
          console.error("[webhook] flow encrypted handling error:", e);
          return NextResponse.json({ ok: false, error: "flow-encrypt-handling-failed" }, { status: 500 });
        }
      }

      // UNENCRYPTED flow path
      if (hasDataExchange || hasFlowWrapper || mayBeFlowViaEntry) {
        const screenFromRequest = (payload?.data_exchange?.screen || payload?.flow?.screen || payload?.screen || "RESULTS");
        const incomingData = payload?.data_exchange?.data || payload?.data || {};
        const requestedScreen = detectRequestedScreen(payload, {}) || String(screenFromRequest || "RESULTS").toUpperCase();
        console.log("[webhook] unencrypted requestedScreen:", requestedScreen);

        // If they asked for SEARCH -> return the single SEARCH screen (base64)
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
        }

        // If they submitted a selected city via data_exchange
        const selectedCity = incomingData?.selected_city || incomingData?.city || null;
        if (selectedCity) {
          const listings = getSeedListingsForCity(selectedCity);
          const flowResponse = buildResultsFlowResponseForListings(listings, { city: selectedCity });
          const flowResponseJson = JSON.stringify(flowResponse);
          const flowResponseBase64 = Buffer.from(flowResponseJson, "utf8").toString("base64");

          // try to extract phone from entry contacts (if present) to create AWATING_LIST_SELECTION meta
          const phoneCandidate = payload?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.wa_id || null;
          const phone = phoneCandidate ? digitsOnly(String(phoneCandidate)) : null;
          if (phone) {
            const listingIds = listings.map((l) => l.id || l._id || "");
            await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: `Found ${listings.length} listings for ${selectedCity}. Reply with the number (1-${listings.length}) to choose.`, meta: { state: "AWAITING_LIST_SELECTION", listingIds } }).catch(() => { });
          }

          return new Response(flowResponseBase64, {
            status: 200,
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Transfer-Encoding": "base64",
              "Cache-Control": "no-store",
            },
          });
        }

        // fallback: return empty RESULTS base64
        const fallback = buildResultsFlowResponseForListings([], {});
        const fallbackBase64 = Buffer.from(JSON.stringify(fallback), "utf8").toString("base64");
        return new Response(fallbackBase64, {
          status: 200,
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Transfer-Encoding": "base64",
            "Cache-Control": "no-store",
          },
        });
      }
    }
  } catch (e) {
    console.error("[webhook] flow-detect/response error", e);
    // fall through to normal processing
  }

  /* -------------------------
     Non-flow processing: conversation routing (unchanged mostly)
     ------------------------- */
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

  const savedMsg = await Message.create(incoming).catch((e) => {
    console.error("[webhook] save message error", e);
    return null;
  });

  // Conversation routing and selection handling
  try {
    const lastMeta = await (async () => {
      const doc = await Message.findOne({ phone: digitsOnly(phone), "meta.state": { $exists: true } }).sort({ createdAt: -1 }).lean().exec();
      return doc?.meta || null;
    })();

    if (!lastMeta) {
      // send menu as before
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
      return NextResponse.json({ ok: true, note: "menu-sent" });
    }

    // If user is choosing from previous results
    if (lastMeta.state === "AWAITING_LIST_SELECTION") {
      // user reply with a number e.g. "1"
      const m = String(parsedText || "").trim();
      if (/^[1-9]\d*$/.test(m)) {
        const idx = parseInt(m, 10) - 1;
        const ids = lastMeta.listingIds || [];
        if (idx >= 0 && idx < ids.length) {
          const listingId = ids[idx];
          // reveal contact
          await revealContactDetails(listingId, phone);
          // update system state message
          await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: `You selected ${m}. Contact details sent.`, meta: { state: "CONTACT_REVEALED", listingId } }).catch(() => { });
          return NextResponse.json({ ok: true, note: "selection-handled" });
        } else {
          await sendText(phone, `Invalid selection. Reply with a number between 1 and ${ids.length}.`);
          return NextResponse.json({ ok: true, note: "selection-invalid" });
        }
      } else {
        // not a number
        await sendText(phone, "Please reply with the number of the listing (e.g. 1).");
        return NextResponse.json({ ok: true, note: "selection-expected-number" });
      }
    }

    // Original menu handling (LIST / SEARCH / PURCHASES)
    if (lastMeta.state === "AWAITING_MENU_CHOICE") {
      const t = String(parsedText || "").trim().toLowerCase();
      if (/^\s*1\s*$/.test(t) || t.startsWith("list") || t === "menu_list") {
        const sys = await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: "Okay — let's list a property. What's the property title?", meta: { state: "LISTING_WAIT_TITLE", draft: {} } }).catch(() => null);
        await sendText(phone, "Okay — let's list a property. What's the property title?");
        await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.handledMenu": true } }).catch(() => { });
        return NextResponse.json({ ok: true, note: "start-listing", sysId: sys?._id || null });
      }
      if (/^\s*2\s*$/.test(t) || t.startsWith("search") || t === "menu_search") {
        // UPDATED: open the Flow search form and also send a quick list of seed results
        const sys = await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: "Opening search form...", meta: { state: "FLOW_OPENED" } }).catch(() => null);

        // Open the flow (clients will see the interactive SEARCH form)
        await sendFlowStart(phone, DEFAULT_FLOW_ID, { selected_city: "harare" }).catch((e) => console.warn("sendFlowStart failed", e));

        // send a short textual summary of top seed listings for the default city so users immediately see examples
        const seed = getSeedListingsForCity("harare");
        if (seed && seed.length) {
          const msg = seed.map((l, i) => `${i + 1}) ${l.title} — ${l.suburb || ""} — $${l.price || l.pricePerMonth || "N/A"}`).join("\n\n");
          await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: `Here are a few examples:\n\n${msg}`, meta: { state: "SEED_LIST_SENT" } }).catch(() => null);
          await sendText(phone, `Here are a few examples:\n\n${msg}`);
          // also send interactive quick-reply buttons for the seed items
          const buttons = seed.map((s, i) => ({ id: `select_${s.id || i}`, title: s.title || `Listing ${i + 1}` }));
          await sendInteractiveButtons(phone, "Or tap a result to view contact details:", buttons).catch(() => { });
        }

        await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.handledMenu": true } }).catch(() => { });
        return NextResponse.json({ ok: true, note: "start-search-flow", sysId: sys?._id || null });
      }
      if (/^\s*3\s*$/.test(t) || t.startsWith("purchase") || t === "menu_purchases") {
        const purchasesPlaceholder = "You have 0 purchases. (This is a placeholder — wire your purchases DB.)";
        const sys = await Message.create({ phone: digitsOnly(phone), from: "system", type: "text", text: purchasesPlaceholder, meta: { state: "SHOW_PURCHASES" } }).catch(() => null);
        await sendText(phone, purchasesPlaceholder);
        await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.handledMenu": true } }).catch(() => { });
        return NextResponse.json({ ok: true, note: "show-purchases", sysId: sys?._id || null });
      }
      await sendText(phone, "Sorry, I didn't understand. Reply with 1 (List), 2 (Search) or 3 (Purchases), or tap a button.");
      return NextResponse.json({ ok: true, note: "menu-repeat" });
    }

    // Search flow (text-based fallback) - unchanged except we now send interactive buttons for results
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

      // send interactive quick-reply buttons for top 3 results so user can tap to select
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
  }

  // Free-text reply window logic & default reply (as before)
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
    await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.needsFollowUp": true } }).catch(() => { });
    return NextResponse.json({ ok: true, note: "not-allowed-to-send-free-text-yet" });
  }

  const replyText = `Hi 👋 Welcome to CribMatch — tell me area and budget (eg. Borrowdale, $200) and I'll find matches.`;
  const sendResp = await sendText(phone, replyText);

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

// helper used earlier - simple placeholder, implement according to your app logic
async function revealContactDetails(listingId, phone) {
  // try to fetch listing and send owner contact to the phone
  try {
    const listing = await getListingById(listingId);
    if (!listing) return;
    const contactMsg = `Contact for ${listing.title}: ${listing.contactName || "Owner"} — ${listing.contactPhone || listing.phone || "N/A"}`;
    await sendText(phone, contactMsg);
  } catch (e) {
    console.warn("revealContactDetails error", e);
  }
}
