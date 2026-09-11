import crypto from "crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function secretsMatch(actual, expected) {
  const left = Buffer.from(String(actual || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function whatsappPost(phoneNumberId, token, payload) {
  const response = await fetch(`https://graph.facebook.com/v24.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok && !data.error, status: response.status, data };
}

async function sendNzvimboOtp(phone, code, expiresInMinutes) {
  const token = process.env.WHATSAPP_API_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;
  const templateName = process.env.WHATSAPP_OTP_TEMPLATE_NAME;
  const languageCode = process.env.WHATSAPP_OTP_TEMPLATE_LANGUAGE || "en_US";
  const templateHasUrlButton = process.env.WHATSAPP_OTP_TEMPLATE_URL_BUTTON === "true";

  if (!token || !phoneNumberId) {
    return { ok: false, status: 500, error: "WhatsApp credentials are not configured." };
  }

  const payload = templateName
    ? {
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: String(code) }],
          },
          ...(templateHasUrlButton
            ? [{
              type: "button",
              sub_type: "url",
              index: "0",
              parameters: [{ type: "text", text: String(code) }],
            }]
            : []),
        ],
      },
    }
    : {
      messaging_product: "whatsapp",
      to: phone,
      type: "text",
      text: {
        body: `Nzvimbo verification code: ${code}. It expires in ${expiresInMinutes} minutes. Do not share this code.`,
      },
    };

  return whatsappPost(phoneNumberId, token, payload);
}

export async function POST(request) {
  const rawBody = await request.text();
  let body;
  try {
    body = JSON.parse(rawBody || "{}");
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  // Nzvimbo calls this same URL with an internal action to deliver an OTP.
  if (body.action === "send_nzvimbo_otp") {
    const expectedSecret = process.env.WHATSAPP_OTP_SHARED_SECRET;
    const suppliedSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!secretsMatch(suppliedSecret, expectedSecret)) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const phone = digitsOnly(body.phone);
    const code = String(body.code || "").trim();
    const expiresInMinutes = Number(body.expiresInMinutes || 10);
    if (!/^2637\d{8}$/.test(phone) || !/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: "Invalid OTP payload." }, { status: 400 });
    }

    const result = await sendNzvimboOtp(phone, code, expiresInMinutes);
    if (!result.ok) {
      console.error("[nzvimbo-otp] WhatsApp send failed", result.data || result.error);
      return NextResponse.json({ error: "WhatsApp delivery failed." }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  }

  // OTP-only mode intentionally ignores inbound WhatsApp messages.
  return NextResponse.json({ ok: true });
}

export async function GET(request) {
  const url = new URL(request.url);
  const expectedToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "";
  if (
    url.searchParams.get("hub.mode") === "subscribe" &&
    url.searchParams.get("hub.verify_token") === expectedToken &&
    url.searchParams.get("hub.challenge")
  ) {
    return new Response(url.searchParams.get("hub.challenge"), { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}
