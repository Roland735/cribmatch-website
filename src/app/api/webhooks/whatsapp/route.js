import crypto from "crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function secretsMatch(actual, expected) {
  const left = Buffer.from(String(actual || ""));
  const right = Buffer.from(String(expected || ""));

  return (
    left.length > 0 &&
    left.length === right.length &&
    crypto.timingSafeEqual(left, right)
  );
}

async function whatsappPost(phoneNumberId, token, payload) {
  const response = await fetch(
    `https://graph.facebook.com/v24.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    }
  );

  const data = await response.json().catch(() => ({}));

  return {
    ok: response.ok && !data.error,
    status: response.status,
    data,
  };
}

async function sendNzvimboOtp(phone, code) {
  const token = process.env.WHATSAPP_API_TOKEN;

  const phoneNumberId =
    process.env.WHATSAPP_PHONE_NUMBER_ID ||
    process.env.WHATSAPP_PHONE_ID;

  const templateName =
    process.env.WHATSAPP_OTP_TEMPLATE_NAME ||
    "nzvimbo_otp";

  const languageCode =
    process.env.WHATSAPP_OTP_TEMPLATE_LANGUAGE ||
    "en_US";

  if (!token || !phoneNumberId) {
    return {
      ok: false,
      status: 500,
      error: "WhatsApp credentials are not configured.",
    };
  }

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: digitsOnly(phone),
    type: "template",
    template: {
      name: templateName,
      language: {
        policy: "deterministic",
        code: languageCode,
      },
      components: [
        {
          type: "body",
          parameters: [
            {
              type: "text",
              text: String(code),
            },
          ],
        },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [
            {
              type: "text",
              text: String(code),
            },
          ],
        },
      ],
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
    return NextResponse.json(
      { error: "Invalid JSON." },
      { status: 400 }
    );
  }

  if (body.action === "send_nzvimbo_otp") {
    const expectedSecret =
      process.env.WHATSAPP_OTP_SHARED_SECRET;

    const suppliedSecret = request.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "");

    if (!expectedSecret) {
      console.error(
        "[nzvimbo-otp] WHATSAPP_OTP_SHARED_SECRET is not configured."
      );

      return NextResponse.json(
        { error: "Server configuration error." },
        { status: 500 }
      );
    }

    if (!secretsMatch(suppliedSecret, expectedSecret)) {
      return NextResponse.json(
        { error: "Unauthorized." },
        { status: 401 }
      );
    }

    const phone = digitsOnly(body.phone);
    const code = String(body.code || "").trim();

    if (!/^2637\d{8}$/.test(phone)) {
      return NextResponse.json(
        { error: "Invalid Zimbabwe phone number." },
        { status: 400 }
      );
    }

    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json(
        { error: "Invalid OTP code." },
        { status: 400 }
      );
    }

    const result = await sendNzvimboOtp(phone, code);

    if (!result.ok) {
      console.error(
        "[nzvimbo-otp] WhatsApp send failed",
        result.data || result.error
      );

      return NextResponse.json(
        {
          error: "WhatsApp delivery failed.",
          providerStatus: result.status,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      messageId: result.data?.messages?.[0]?.id || null,
    });
  }

  // OTP-only mode intentionally ignores inbound WhatsApp messages.
  return NextResponse.json({ ok: true });
}

export async function GET(request) {
  const url = new URL(request.url);

  const expectedToken =
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "";

  const mode = url.searchParams.get("hub.mode");
  const suppliedToken =
    url.searchParams.get("hub.verify_token");
  const challenge =
    url.searchParams.get("hub.challenge");

  if (
    mode === "subscribe" &&
    expectedToken &&
    suppliedToken === expectedToken &&
    challenge
  ) {
    return new Response(challenge, {
      status: 200,
    });
  }

  return new Response("Forbidden", {
    status: 403,
  });
}