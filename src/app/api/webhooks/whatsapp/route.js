// app/api/webhooks/whatsapp/route.js
import { NextResponse } from "next/server";
import { dbConnect, WebhookEvent } from "@/lib/db";
import Message from "@/lib/Message";

const WHATCHIMP_SEND_ENDPOINT = "https://app.whatchimp.com/api/v1/whatsapp/send";

async function saveWebhookEvent(provider, headers, payload) {
  try {
    return await WebhookEvent.create({
      provider,
      headers,
      payload,
      receivedAt: new Date(),
    });
  } catch (err) {
    console.error("[webhook] saveWebhookEvent failed:", err);
    return null;
  }
}

async function upsertMessage(parsed) {
  try {
    if (parsed.wa_message_id) {
      return await Message.findOneAndUpdate(
        { wa_message_id: parsed.wa_message_id },
        { $set: parsed },
        { upsert: true, new: true }
      );
    } else {
      return await Message.create(parsed);
    }
  } catch (err) {
    console.error("[webhook] upsertMessage failed:", err);
    return null;
  }
}

async function sendAutoReply(phoneNumber, text) {
  const apiToken = process.env.WHATCHIMP_API_KEY;
  const phone_number_id = process.env.WHATCHIMP_PHONE_ID;
  if (!apiToken || !phone_number_id) {
    console.warn("[webhook] WHATCHIMP_API_KEY or WHATCHIMP_PHONE_ID not set — skipping auto-reply");
    return { error: "missing-credentials" };
  }

  const body = new URLSearchParams({
    apiToken: apiToken,
    phone_number_id,
    phone_number: String(phoneNumber).replace(/\D/g, ""),
    message: text,
  });

  const res = await fetch(WHATCHIMP_SEND_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  try {
    const json = await res.json();
    return json;
  } catch (e) {
    return { error: "invalid-json-response", status: res.status || "unknown" };
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, msg: "WhatChimp webhook (App Router) is live" });
}

export async function POST(request) {
  console.log("[webhook] POST invoked");
  // connect DB
  try {
    await dbConnect();
  } catch (err) {
    console.error("[webhook] DB connect failed:", err);
    return NextResponse.json({ ok: false, error: "DB connection failed" }, { status: 500 });
  }

  // read body robustly
  let payload = {};
  try {
    payload = await request.json();
  } catch (err) {
    try {
      const txt = await request.text();
      payload = txt ? JSON.parse(txt) : {};
    } catch (e) {
      payload = {};
    }
  }

  // save raw event (best-effort)
  try {
    const headersObj = Object.fromEntries(request.headers.entries());
    await saveWebhookEvent("whatchimp", headersObj, payload);
  } catch (e) {
    console.warn("[webhook] saveWebhookEvent error (ignored):", e);
  }

  try {
    // Prefer top-level WhatChimp fields when present
    let messageBlock = payload;
    if (payload.user_message) {
      messageBlock = { text: payload.user_message };
    } else if (payload.message_content && typeof payload.message_content === "string") {
      try {
        messageBlock = JSON.parse(payload.message_content);
      } catch (e) {
        messageBlock = payload.message_content;
      }
    } else if (payload.message) {
      messageBlock = payload.message;
    } else if (payload.data) {
      messageBlock = payload.data;
    }

    // Normalize phone: chat_id -> subscriber_id left part -> other fallbacks
    let rawPhone =
      payload.chat_id ||
      (payload.subscriber_id ? String(payload.subscriber_id).split("-")[0] : null) ||
      payload.phone_number ||
      payload.from ||
      messageBlock.to ||
      messageBlock.from ||
      messageBlock.recipient ||
      null;

    const phone = rawPhone ? String(rawPhone).replace(/\D/g, "") : null;

    const wa_message_id = payload.wa_message_id || messageBlock.wa_message_id || payload.message_id || null;
    const message_status =
      payload.message_status ||
      payload.delivery_status ||
      messageBlock.message_status ||
      messageBlock.delivery_status ||
      null;

    // parse message type/text
    let type = "unknown";
    let text = "";
    const meta = {};

    if (messageBlock.interactive || messageBlock.type === "interactive") {
      type = "interactive";
      meta.interactive = messageBlock.interactive || null;
      if (messageBlock.interactive?.button_reply?.title) {
        text = messageBlock.interactive.button_reply.title;
        meta.postback_id = messageBlock.interactive.button_reply.id || null;
      } else if (messageBlock.interactive?.list_reply?.title) {
        text = messageBlock.interactive.list_reply.title;
        meta.postback_id = messageBlock.interactive.list_reply.id || null;
      } else {
        text = JSON.stringify(messageBlock.interactive || {}).slice(0, 2000);
      }
    } else if (
      messageBlock.type === "text" ||
      messageBlock.text ||
      messageBlock.body?.text ||
      payload.message_type === "text" ||
      payload.user_message
    ) {
      type = "text";
      text =
        payload.user_message ||
        (messageBlock.text && (messageBlock.text.body || messageBlock.text)) ||
        messageBlock.body?.text ||
        payload.message ||
        "";
      if (typeof text === "object") text = JSON.stringify(text).slice(0, 2000);
    } else if (messageBlock.type === "image" || messageBlock.image || messageBlock.type === "audio" || messageBlock.video) {
      type = "media";
      meta.media = messageBlock.image || messageBlock.video || messageBlock.audio || null;
      text = (messageBlock.caption && messageBlock.caption.text) || messageBlock.caption || "";
    } else if (message_status) {
      type = "status";
      text = message_status;
    } else {
      type = "unknown";
      text = JSON.stringify(payload).slice(0, 2000);
    }

    const parsed = {
      phone,
      from: payload.sender || payload.from || "user",
      wa_message_id,
      type,
      text,
      raw: payload,
      status: message_status || null,
      meta,
      conversationId: payload.conversation_id || null,
    };

    const savedMsg = await upsertMessage(parsed);

    // Auto reply: simple trigger for greetings or 'start'
    const lc = (text || "").toString().toLowerCase();
    if (type === "text" && (lc === "hi" || lc === "hello" || lc === "hey" || lc.includes("start"))) {
      const replyText = `Hi 👋 Welcome to CribMatch — tell me area and budget (eg. Borrowdale, $200) and I'll find matches.`;
      try {
        const sendResp = await sendAutoReply(phone, replyText);
        console.log("[webhook] Auto-reply sent:", sendResp);
      } catch (e) {
        console.error("[webhook] Auto-reply failed:", e);
      }
    } else {
      console.log("[webhook] No auto-reply trigger matched. Incoming text:", text?.slice(0, 200));
    }

    return NextResponse.json({ ok: true, savedMessageId: savedMsg?._id || null });
  } catch (err) {
    console.error("[webhook] processing error:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
