// app/api/webhooks/whatsapp/route.js
import { NextResponse } from "next/server";
import { dbConnect, WebhookEvent } from "@/lib/db";
import Message from "@/lib/Message";

export const runtime = "nodejs";

const WHATCHIMP_SEND_ENDPOINT = "https://app.whatchimp.com/api/v1/whatsapp/send";
const WHATCHIMP_SUBSCRIBER_GET = "https://app.whatchimp.com/api/v1/whatsapp/subscriber/get";
const WHATCHIMP_GET_CONVERSATION = "https://app.whatchimp.com/api/v1/whatsapp/get/conversation";

function digitsOnly(v) {
  return String(v || "").replace(/\D/g, "");
}

async function whatChimpPost(url, formObj) {
  const body = new URLSearchParams(formObj);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  try { return await res.json(); } catch (e) { return { error: "invalid-json", status: res.status }; }
}

async function sendText(phoneNumber, message) {
  const apiToken = process.env.WHATCHIMP_API_KEY;
  const phone_number_id = process.env.WHATCHIMP_PHONE_ID;
  if (!apiToken || !phone_number_id) return { error: "missing-credentials" };
  return whatChimpPost(WHATCHIMP_SEND_ENDPOINT, {
    apiToken,
    phone_number_id,
    phone_number: digitsOnly(phoneNumber),
    message,
  });
}

// tries a function fn up to attempts times with delay ms between attempts
async function retry(fn, attempts = 3, delay = 400) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise(r => setTimeout(r, delay));
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

export async function POST(request) {
  console.log("[webhook] POST invoked");
  try { await dbConnect(); } catch (err) {
    console.error("[webhook] DB connect failed", err);
    return NextResponse.json({ ok: false, error: "DB connect failed" }, { status: 500 });
  }

  // parse body
  let payload = {};
  try { payload = await request.json(); } catch (err) {
    try { const t = await request.text(); payload = t ? JSON.parse(t) : {}; } catch (e) { payload = {}; }
  }
  console.log("[webhook] payload keys:", Object.keys(payload));

  // persist raw event (best-effort)
  try {
    const headersObj = Object.fromEntries(request.headers.entries());
    await WebhookEvent.create({ provider: "whatchimp", headers: headersObj, payload, receivedAt: new Date() });
  } catch (e) { console.warn("[webhook] save raw event failed:", e); }

  // Normalize messageBlock and phone candidates
  let messageBlock = payload;
  if (payload.user_message) messageBlock = { text: payload.user_message };
  else if (payload.message_content && typeof payload.message_content === "string") {
    try { messageBlock = JSON.parse(payload.message_content); } catch (e) { messageBlock = payload.message_content; }
  } else if (payload.message) messageBlock = payload.message;
  else if (payload.data) messageBlock = payload.data;

  // Prefer chat_id, then left part of subscriber_id, then other known fields
  const rawCandidates = [
    payload.chat_id,
    payload.subscriber_id ? String(payload.subscriber_id).split("-")[0] : null,
    payload.phone_number,
    payload.from,
    messageBlock?.to,
    messageBlock?.from,
    messageBlock?.recipient,
  ].filter(Boolean);

  const phone = digitsOnly(rawCandidates[0] || "");

  // Save the incoming message into your DB
  const parsedText = payload.user_message || (messageBlock && (messageBlock.text || messageBlock.body?.text)) || "";
  const incoming = {
    phone,
    from: payload.sender || payload.from || "user",
    wa_message_id: payload.wa_message_id || messageBlock?.wa_message_id || payload.message_id || null,
    type: parsedText ? "text" : "unknown",
    text: parsedText,
    raw: payload,
    status: null,
    meta: {},
    conversationId: payload.conversation_id || null,
  };

  const savedMsg = await Message.create(incoming).catch(e => { console.error("[webhook] save message error", e); return null; });

  // helper to check WhatChimp subscriber and conversation (with retries to handle race)
  const apiToken = process.env.WHATCHIMP_API_KEY;
  const phone_number_id = process.env.WHATCHIMP_PHONE_ID;
  if (!apiToken || !phone_number_id) {
    console.error("[webhook] missing WHATCHIMP_API_KEY or WHATCHIMP_PHONE_ID in env");
    return NextResponse.json({ ok: false, error: "missing-whatchimp-credentials" }, { status: 500 });
  }

  // Try subscriber/get and get/conversation with a few quick retries to avoid race condition
  let subscriberResp = null;
  try {
    subscriberResp = await retry(() => whatChimpPost(WHATCHIMP_SUBSCRIBER_GET, {
      apiToken, phone_number_id, phone_number: phone,
    }), 3, 300);
    console.log("[webhook] subscriber/get:", subscriberResp);
  } catch (e) {
    console.error("[webhook] subscriber/get failed after retries:", e);
  }

  // If subscriber exists, check conversation for last incoming message time
  let allowedToSend = false;
  try {
    const convResp = await retry(() => whatChimpPost(WHATCHIMP_GET_CONVERSATION, {
      apiToken, phone_number_id, phone_number: phone, limit: 10, offset: 0,
    }), 3, 300);
    console.log("[webhook] get/conversation:", convResp);

    if (convResp?.status === "1" && Array.isArray(convResp.message) && convResp.message.length > 0) {
      // Try to find the latest incoming user message timestamp (conversation_time)
      // The response message entries may be both bot and user; we consider timestamps.
      const timestamps = convResp.message
        .map(m => m.conversation_time)
        .filter(Boolean)
        .map(s => new Date(String(s).replace(" ", "T")))
        .filter(d => !Number.isNaN(d.getTime()));

      if (timestamps.length > 0) {
        const latest = timestamps.sort((a, b) => b - a)[0];
        const ageMs = Date.now() - latest.getTime();
        console.log(`[webhook] latest conversation_time ageMs=${ageMs}ms`);
        // allow free-text if incoming message was within this window (configurable)
        const ALLOWED_WINDOW_MS = 5 * 60 * 1000; // 5 minutes (you can raise to 15m if you prefer)
        if (ageMs <= ALLOWED_WINDOW_MS) allowedToSend = true;
        else {
          // often still OK if the webhook arrived at the same time but conv hasn't been written — keep a final short retry
          console.log("[webhook] latest message older than ALLOWED_WINDOW_MS; not allowed to send free-text");
          allowedToSend = false;
        }
      } else {
        // no timestamps available — be conservative: don't send free-text
        allowedToSend = false;
      }
    } else {
      // No conversation data yet — possible race or subscriber not created — deny free-text
      allowedToSend = false;
      console.log("[webhook] no conversation found for subscriber (race or not yet created).");
    }
  } catch (e) {
    console.error("[webhook] conversation check error:", e);
    allowedToSend = false;
  }

  console.log("[webhook] allowedToSend =", allowedToSend);

  if (!allowedToSend) {
    // Mark for follow-up and return 200 quickly
    await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.needsFollowUp": true, "meta.subscriberResp": subscriberResp || null } }).catch(() => { });
    return NextResponse.json({ ok: true, note: "not-allowed-to-send-free-text-yet" });
  }

  // If allowed, attempt the free-text send
  const replyText = `Hi 👋 Welcome to CribMatch — tell me area and budget (eg. Borrowdale, $200) and I'll find matches.`;
  const sendResp = await sendText(phone, replyText);
  console.log("[webhook] sendText response:", sendResp);

  // If send rejected due to 24-hour window, mark for template/manual follow-up
  if (sendResp?.status === "0" && /24 hour/i.test(String(sendResp.message || ""))) {
    await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.templateRequired": true, "meta.sendResp": sendResp } }).catch(() => { });
    return NextResponse.json({ ok: true, note: "send-rejected-24-hour", sendResp });
  }

  // Success path: record send result and return 200
  await Message.findByIdAndUpdate(savedMsg?._id, { $set: { "meta.sendResp": sendResp } }).catch(() => { });
  return NextResponse.json({ ok: true, savedMessageId: savedMsg?._id || null, sendResp });
}
