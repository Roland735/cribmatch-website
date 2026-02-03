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

function normalizeSignatureHeader(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.toLowerCase().startsWith("sha256=") ? trimmed.slice(7) : trimmed;
}

function getWebhookSecret() {
  if (process.env.WHATSAPP_WEBHOOK_APP_SECRET) return process.env.WHATSAPP_WEBHOOK_APP_SECRET;
  if (process.env.WHATSAPP_APP_SECRET) return process.env.WHATSAPP_APP_SECRET;
  if (process.env.META_APP_SECRET) return process.env.META_APP_SECRET;
  return "";
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
  if (secret) {
    const signatureHeader = request.headers.get("x-hub-signature-256") ?? "";
    const signature = normalizeSignatureHeader(signatureHeader);
    if (!signature) {
      return Response.json({ error: "Missing signature" }, { status: 401 });
    }

    const computed = crypto
      .createHmac("sha256", secret)
      .update(rawBody, "utf8")
      .digest("hex")
      .toLowerCase();

    if (!timingSafeEqualHex(signature, computed)) {
      return Response.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  if (!rawBody) return Response.json({ ok: true });

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (process.env.MONGODB_URI) {
    try {
      await dbConnect();
      await WebhookEvent.create({
        provider: "whatsapp",
        headers: {
          "x-hub-signature-256": request.headers.get("x-hub-signature-256") ?? "",
          "user-agent": request.headers.get("user-agent") ?? "",
        },
        payload,
      });
    } catch { }
  }

  return Response.json({ ok: true });
}
