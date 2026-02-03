import crypto from "crypto";
import { dbConnect, WebhookEvent } from "@/lib/db";

export const runtime = "nodejs";

function timingSafeEqualUtf8(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
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
  if (!whatchimpUrl || !whatchimpKey) {
    return { ok: false, error: "Missing WhatChimp send configuration" };
  }

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

export async function GET(request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode") ?? "";
  const token = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";

  const expectedApiKey = process.env.WHATCHIMP_API_KEY ?? "";
  if (expectedApiKey) {
    const providedApiKey = extractApiKeyFromHeaders(request.headers);
    if (!providedApiKey || !timingSafeEqualUtf8(providedApiKey, expectedApiKey)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (mode === "subscribe" && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  if (mode === "subscribe" && token && !challenge) {
    return Response.json({ error: "Missing challenge" }, { status: 400 });
  }

  return Response.json({ ok: true });
}

export async function POST(request) {
  const rawBody = await request.text();

  const expectedApiKey = process.env.WHATCHIMP_API_KEY ?? "";
  if (expectedApiKey) {
    const providedApiKey = extractApiKeyFromHeaders(request.headers);
    if (!providedApiKey || !timingSafeEqualUtf8(providedApiKey, expectedApiKey)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
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
