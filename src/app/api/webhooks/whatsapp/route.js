// pages/api/webhooks/whatsapp.js
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
    console.error("Failed to save WebhookEvent:", err);
    return null;
  }
}

async function upsertMessage(parsed) {
  if (parsed.wa_message_id) {
    const found = await Message.findOneAndUpdate(
      { wa_message_id: parsed.wa_message_id },
      { $set: parsed },
      { upsert: true, new: true }
    );
    return found;
  } else {
    const created = await Message.create(parsed);
    return created;
  }
}

async function sendAutoReply(phoneNumber, text) {
  const apiToken = process.env.WHATCHIMP_API_KEY;
  const phone_number_id = process.env.WHATCHIMP_PHONE_ID;
  if (!apiToken || !phone_number_id) {
    console.warn("WHATCHIMP_API_KEY or WHATCHIMP_PHONE_ID not set — skipping auto-reply");
    return null;
  }

  const body = new URLSearchParams({
    apiToken: apiToken,
    phone_number_id,
    phone_number: String(phoneNumber).replace(/\D/g, ""), // digits only
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
    return { error: "invalid-json-response", status: res.status };
  }
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, msg: "WhatChimp webhook is live" });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).end("Method Not Allowed");
  }

  // connect DB
  try {
    await dbConnect();
  } catch (err) {
    console.error("DB connect failed:", err);
    return res.status(500).json({ ok: false, error: "DB connection failed" });
  }

  // parse body robustly
  let payload = {};
  try {
    payload = req.body && Object.keys(req.body).length ? req.body : await req.json();
  } catch (err) {
    try {
      const text = await req.text();
      payload = text ? JSON.parse(text) : {};
    } catch (e) {
      payload = {};
    }
  }

  // store raw event (best effort)
  try {
    await saveWebhookEvent("whatchimp", req.headers, payload);
  } catch (e) {
    // ignore
  }

  try {
    // If WhatChimp uses top-level fields like "user_message" or "chat_id", prefer those.
    // Otherwise fall back to deeper "message", "message_content", "data"
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

    // Normalize phone: prefer explicit chat_id, then subscriber_id (left part), then other fields.
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

    // message id / status
    const wa_message_id = payload.wa_message_id || messageBlock.wa_message_id || payload.message_id || null;
    const message_status =
      payload.message_status ||
      payload.delivery_status ||
      messageBlock.message_status ||
      messageBlock.delivery_status ||
      null;

    // parse type/text/meta
    let type = "unknown";
    let text = "";
    const meta = {};

    // interactive (buttons / list)
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
    }
    // text (include top-level user_message)
    else if (
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
    }
    // media
    else if (messageBlock.type === "image" || messageBlock.image || messageBlock.type === "audio" || messageBlock.video) {
      type = "media";
      meta.media = messageBlock.image || messageBlock.video || messageBlock.audio || null;
      text = (messageBlock.caption && messageBlock.caption.text) || messageBlock.caption || "";
    }
    // status update
    else if (message_status) {
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

    // Auto-reply triggers
    const lc = (text || "").toString().toLowerCase();
    if (type === "text" && (lc === "hi" || lc === "hello" || lc === "hey" || lc.includes("start"))) {
      const replyText = `Hi 👋 Welcome to CribMatch — tell me area and budget (eg. Borrowdale, $200) and I'll find matches.`;
      try {
        const sendResp = await sendAutoReply(phone, replyText);
        console.log("Auto-reply sent:", sendResp);
      } catch (e) {
        console.error("Auto-reply failed:", e);
      }
    }

    return res.status(200).json({ ok: true, savedMessageId: savedMsg?._id || null });
  } catch (err) {
    console.error("Webhook processing error:", err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
