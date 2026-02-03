import crypto from "crypto";
import { dbConnect, WebhookEvent } from "@/lib/db";

export const runtime = "nodejs";

function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function timingSafeEqualUtf8(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function normalizeSignatureHeader(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.toLowerCase().startsWith("sha256=") ? trimmed.slice(7) : trimmed;
}

function extractApiKeyFromHeaders(headers) {
  const direct =
    headers.get("x-whatchimp-api-key") ??
    headers.get("whatchimp-api-key") ??
    headers.get("x-api-key") ??
    headers.get("api-key") ??
    "";

  if (direct) return direct.trim();

  const auth = headers.get("authorization") ?? "";
  if (!auth) return "";
  const trimmed = auth.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("bearer ")) return trimmed.slice(7).trim();
  if (lower.startsWith("apikey ")) return trimmed.slice(6).trim();
  return trimmed;
}

function getWebhookSecret() {
  if (process.env.WHATSAPP_WEBHOOK_APP_SECRET) return process.env.WHATSAPP_WEBHOOK_APP_SECRET;
  if (process.env.WHATSAPP_APP_SECRET) return process.env.WHATSAPP_APP_SECRET;
  if (process.env.META_APP_SECRET) return process.env.META_APP_SECRET;
  return "";
}

function toSafeString(value) {
  return typeof value === "string" ? value : "";
}

function normalizeHiMessage(value) {
  const trimmed = toSafeString(value).trim().toLowerCase();
  if (!trimmed) return "";
  return trimmed.replace(/[^\p{L}\p{N}\s]/gu, "");
}

function extractIncomingTextMessages(payload) {
  const results = [];

  const directMessages = Array.isArray(payload?.messages) ? payload.messages : null;
  if (directMessages) {
    for (const msg of directMessages) {
      const type = toSafeString(msg?.type);
      const textBody = toSafeString(msg?.text?.body ?? msg?.text ?? msg?.body);
      const from = toSafeString(msg?.from ?? msg?.wa_id ?? msg?.waId);
      if (type === "text" && from && textBody) {
        results.push({ from, textBody, id: toSafeString(msg?.id) });
      }
    }
  }

  const entries = Array.isArray(payload?.entry) ? payload.entry : null;
  if (!entries) return results;

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : null;
    if (!changes) continue;
    for (const change of changes) {
      const value = change?.value;
      const messages = Array.isArray(value?.messages) ? value.messages : null;
      if (!messages) continue;
      for (const msg of messages) {
        const type = toSafeString(msg?.type);
        const textBody = toSafeString(msg?.text?.body);
        const from = toSafeString(msg?.from);
        if (type === "text" && from && textBody) {
          results.push({ from, textBody, id: toSafeString(msg?.id) });
        }
      }
    }
  }

  return results;
}

async function sendWhatsAppText({ to, body }) {
  const text = toSafeString(body).trim();
  const recipient = toSafeString(to).trim();
  if (!text || !recipient) return { ok: false, error: "Missing to/body" };

  const whatchimpUrl = toSafeString(process.env.WHATCHIMP_SEND_MESSAGE_URL).trim();
  const whatchimpKey = toSafeString(process.env.WHATCHIMP_API_KEY).trim();
  if (whatchimpUrl && whatchimpKey) {
    const res = await fetch(whatchimpUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${whatchimpKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        to: recipient,
        type: "text",
        text: { body: text },
      }),
    });

    if (!res.ok) return { ok: false, error: `WhatChimp send failed: ${res.status}` };
    return { ok: true };
  }

  const accessToken =
    toSafeString(process.env.WHATSAPP_ACCESS_TOKEN).trim() ||
    toSafeString(process.env.WHATSAPP_CLOUD_ACCESS_TOKEN).trim();
  const phoneNumberId =
    toSafeString(process.env.WHATSAPP_PHONE_NUMBER_ID).trim() ||
    toSafeString(process.env.WHATSAPP_API_PHONE_NUMBER_ID).trim();
  const apiVersion = toSafeString(process.env.WHATSAPP_API_VERSION).trim() || "v20.0";

  if (!accessToken || !phoneNumberId) {
    return { ok: false, error: "Missing WhatsApp send configuration" };
  }

  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: recipient,
      type: "text",
      text: { body: text },
    }),
  });

  if (!res.ok) return { ok: false, error: `WhatsApp Cloud send failed: ${res.status}` };
  return { ok: true };
}

export async function GET(request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode") ?? "";
  const token = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";

  if (mode !== "subscribe") {
    return Response.json({ error: "Invalid mode" }, { status: 400 });
  }

  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "";
  if (!expected) {
    return Response.json(
      { error: "WHATSAPP_WEBHOOK_VERIFY_TOKEN is not set" },
      { status: 500 },
    );
  }

  if (!challenge || token !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return new Response(challenge, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export async function POST(request) {
  const rawBody = await request.text();

  const secret = getWebhookSecret();
  const signatureHeader = request.headers.get("x-hub-signature-256") ?? "";
  const signature = normalizeSignatureHeader(signatureHeader);
  const shouldVerifySignature = Boolean(secret && signature);
  if (shouldVerifySignature) {
    const computed = crypto
      .createHmac("sha256", secret)
      .update(rawBody, "utf8")
      .digest("hex")
      .toLowerCase();

    if (!timingSafeEqualHex(signature, computed)) {
      return Response.json({ error: "Invalid signature" }, { status: 401 });
    }
  } else {
    const expectedApiKey = process.env.WHATCHIMP_API_KEY ?? "";
    if (expectedApiKey) {
      const providedApiKey = extractApiKeyFromHeaders(request.headers);
      if (!providedApiKey || !timingSafeEqualUtf8(providedApiKey, expectedApiKey)) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
    }
  }

  if (!rawBody) return Response.json({ ok: true });

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const incoming = extractIncomingTextMessages(payload);
  if (incoming.length) {
    const replyText =
      "Hi! Welcome to CribMatch. Tell me your suburb, budget, and bedrooms.";

    for (const message of incoming) {
      const normalized = normalizeHiMessage(message.textBody);
      if (normalized === "hi" || normalized === "hello") {
        try {
          await sendWhatsAppText({ to: message.from, body: replyText });
        } catch { }
      }
    }
  }

  if (process.env.MONGODB_URI) {
    try {
      await dbConnect();
      await WebhookEvent.create({
        provider: "whatsapp",
        headers: {
          "x-hub-signature-256": request.headers.get("x-hub-signature-256") ?? "",
          "user-agent": request.headers.get("user-agent") ?? "",
          "x-api-key": request.headers.get("x-api-key") ?? "",
          authorization: request.headers.get("authorization") ?? "",
        },
        payload,
      });
    } catch { }
  }

  return Response.json({ ok: true });
}
