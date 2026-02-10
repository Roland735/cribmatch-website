// app/api/webhooks/whatsapp/test/route.js
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function digitsOnly(v) {
  return String(v || "").replace(/\D/g, "");
}

async function sendWhatsAppText(toPhone, message) {
  const token = process.env.WHATSAPP_API_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneNumberId) {
    // no credentials configured — return a descriptive object but do not throw
    return { error: "missing-credentials" };
  }

  const url = `https://graph.facebook.com/v24.0/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: digitsOnly(toPhone),
    type: "text",
    text: { body: message },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  try {
    return await res.json();
  } catch (err) {
    return { error: "invalid-json", status: res.status };
  }
}

/** Simple GET used for webhook verification (optional) */
export async function GET(request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expectedToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || "";

  if (mode === "subscribe" && token && challenge && token === expectedToken) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("OK", { status: 200 });
}

/** POST: receive payload, log sender & text, reply with a test message */
export async function POST(request) {
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

  // Attempt to extract sender and text from common WhatsApp webhook shapes
  const tryGet = (path) => {
    try {
      return path();
    } catch (e) {
      return undefined;
    }
  };

  const sender =
    tryGet(() => payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from) ||
    tryGet(() => payload.from) ||
    tryGet(() => payload.phone_number) ||
    tryGet(() => payload.chat_id) ||
    tryGet(() => payload?.contacts?.[0]?.wa_id) ||
    "";

  const text =
    tryGet(() => payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body) ||
    tryGet(() => payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.body) ||
    tryGet(() => payload.message_content) ||
    tryGet(() => payload.user_message) ||
    tryGet(() => payload.message?.text) ||
    "";

  // Log to server console for easy debugging
  console.log("[test-webhook] raw payload:", JSON.stringify(payload).slice(0, 2000));
  console.log("[test-webhook] sender:", sender);
  console.log("[test-webhook] text:", text);

  // Send quick test reply (best-effort). Will return error details if credentials missing.
  let sendResp = null;
  try {
    if (sender) {
      sendResp = await sendWhatsAppText(sender, `Test received ✅\nWe got your message: "${String(text).slice(0, 200)}"`);
      console.log("[test-webhook] sendResp:", sendResp);
    } else {
      console.log("[test-webhook] no sender found — skipping reply");
    }
  } catch (e) {
    console.warn("[test-webhook] send error:", e);
    sendResp = { error: String(e) };
  }

  return NextResponse.json(
    {
      ok: true,
      note: "test-webhook-received",
      received: { sender: String(sender || ""), text: String(text || "") },
      sendResp,
    },
    { status: 200 }
  );
}
