// app/api/webhooks/whatsapp/route.js
import { NextResponse } from "next/server";
import { dbConnect, WebhookEvent } from "@/lib/db";
import Message from "@/lib/Message";

export const runtime = "nodejs";

// Graph API send endpoint (we post to /{PHONE_NUMBER_ID}/messages)
// The code below will use the env var WHATSAPP_API_TOKEN and WHATSAPP_PHONE_NUMBER_ID

function digitsOnly(v) {
  return String(v || "").replace(/\D/g, "");
}

async function whatsappPost(phone_number_id, token, bodyObj) {
  const url = `https://graph.facebook.com/v22.0/${phone_number_id}/messages`;
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
  // Accept both new env names and the old Whatchimp names for smooth migration
  const apiToken = process.env.WHATSAPP_API_TOKEN || process.env.WHATCHIMP_API_KEY;
  const phone_number_id = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATCHIMP_PHONE_ID || process.env.WHATCHIMP_PHONE_NUMBER_ID;
  if (!apiToken || !phone_number_id) return { error: "missing-credentials" };

  const payload = {
    messaging_product: "whatsapp",
    to: digitsOnly(phoneNumber),
    type: "text",
    text: { body: message },
  };

  return whatsappPost(phone_number_id, apiToken, payload);
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
    process.env.WHATSAPP_VERIFY_TOKEN ||
    process.env.WHATSAPP_WEBHOOK_TOKEN ||
    process.env.WHATSAPP_TOKEN ||
    process.env.META_WEBHOOK_VERIFY_TOKEN ||
    process.env.WEBHOOK_VERIFY_TOKEN ||
    "";

  if (!expectedToken) {
    return new Response("Missing verify token", {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (mode === "subscribe" && token && challenge && token === expectedToken) {
    return new Response(challenge, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return new Response("Forbidden", {
    status: 403,
    headers: { "Cache-Control": "no-store" },
  });
}

function extractTimestamp(payload, messageBlock) {
  // WhatsApp/Meta commonly provides timestamps as seconds since epoch (string or number) in
  // entry[0].changes[0].value.messages[0].timestamp or in message objects as 'timestamp'.
  // Also some providers use ISO strings. We'll try multiple locations and formats.
  const candidates = [];
  if (payload?.timestamp) candidates.push(payload.timestamp);
  if (messageBlock?.timestamp) candidates.push(messageBlock.timestamp);
  if (messageBlock?.conversation_time) candidates.push(messageBlock.conversation_time);
  // try deep common WhatsApp structure
  try {
    const msg =
      payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] ||
      payload?.messages?.[0] ||
      messageBlock?.messages?.[0];
    if (msg?.timestamp) candidates.push(msg.timestamp);
  } catch (e) { }

  for (const c of candidates) {
    if (!c) continue;
    // numeric (unix seconds)
    if (/^\d+$/.test(String(c))) {
      const n = Number(String(c));
      // if it's seconds (10 digits) -> convert to ms
      if (String(c).length <= 10) return n * 1000;
      return n; // already ms
    }
    // ISO date
    const d = new Date(String(c));
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  return null;
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

  // persist raw event (best-effort)
  try {
    const headersObj = Object.fromEntries(request.headers.entries());
    await WebhookEvent.create({ provider: "whatsapp", headers: headersObj, payload, receivedAt: new Date() });
  } catch (e) {
    console.warn("[webhook] save raw event failed:", e);
  }

  // Normalize messageBlock and phone candidates (keep your original heuristics)
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
    // try WhatsApp entries
    payload?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.wa_id,
    payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from,
  ].filter(Boolean);

  const phone = digitsOnly(rawCandidates[0] || "");

  // Save the incoming message into your DB
  const parsedText =
    payload.user_message || (messageBlock && (messageBlock.text || messageBlock.body?.text || messageBlock.body?.plain)) || "";

  const incoming = {
    phone,
    from: payload.sender || payload.from || messageBlock?.from || "user",
    wa_message_id: payload.wa_message_id || messageBlock?.wa_message_id || payload.message_id || (payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id) || null,
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

  // Determine whether we are allowed to send free-text based on last user message timestamp
  // Default policy window is 24 hours (WhatsApp messaging window). You can override with env WHATSAPP_FREE_WINDOW_MS
  const windowMs = Number(process.env.WHATSAPP_FREE_WINDOW_MS) || 24 * 60 * 60 * 1000;
  let allowedToSend = false;

  const ts = extractTimestamp(payload, messageBlock);
  if (ts) {
    const age = Date.now() - ts;
    console.log(`[webhook] incoming message ageMs=${age}`);
    if (age <= windowMs) allowedToSend = true;
  } else {
    // fallback: if we just saved a message (savedMsg) consider it fresh
    if (savedMsg) allowedToSend = true;
  }

  console.log("[webhook] allowedToSend =", allowedToSend);

  if (!allowedToSend) {
    // Mark for follow-up and return 200 quickly
    await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.needsFollowUp": true } }).catch(() => { });
    return NextResponse.json({ ok: true, note: "not-allowed-to-send-free-text-yet" });
  }

  // If allowed, attempt the free-text send using Graph API
  const replyText = `Hi 👋 Welcome to CribMatch — tell me area and budget (eg. Borrowdale, $200) and I'll find matches.`;
  const sendResp = await sendText(phone, replyText);
  console.log("[webhook] sendText response:", sendResp);

  // If Graph API returned an error about message template / 24-hour window it will be in sendResp.error
  if (sendResp?.error) {
    // Save error for manual follow-up
    await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.sendError": sendResp } }).catch(() => { });
    // If error indicates 24-hour policy, mark templateRequired
    const msg = String(sendResp?.error?.message || sendResp?.error || "");
    if (/24 hour|message template/i.test(msg)) {
      await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.templateRequired": true, "meta.sendResp": sendResp } }).catch(() => { });
      return NextResponse.json({ ok: true, note: "send-rejected-24-hour", sendResp });
    }
    return NextResponse.json({ ok: false, error: sendResp }, { status: 500 });
  }

  // Success path: record send result and return 200
  await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.sendResp": sendResp } }).catch(() => { });
  return NextResponse.json({ ok: true, savedMessageId: savedMsg?._id || null, sendResp });
}
