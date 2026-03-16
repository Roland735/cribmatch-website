import { NextResponse } from "next/server";
import { dbConnect, PaymentTransaction, WebhookEvent } from "@/lib/db";

export const runtime = "nodejs";

function mapStatus(status) {
  const value = String(status || "").toLowerCase();
  if (value === "paid" || value === "delivered" || value === "awaiting delivery") return "paid";
  if (value.includes("cancel")) return "cancelled";
  if (value.includes("fail") || value.includes("error")) return "failed";
  return "pending_confirmation";
}

async function handlePaynowWebhook(request, params) {
  const url = new URL(request.url);
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const reference = String(
    body?.reference ||
    body?.Reference ||
    body?.merchantreference ||
    body?.MerchantReference ||
    url.searchParams.get("reference") ||
    url.searchParams.get("merchantreference") ||
    ""
  ).trim();

  const paynowReference = String(
    body?.paynowreference ||
    body?.PaynowReference ||
    url.searchParams.get("paynowreference") ||
    ""
  ).trim();

  const statusRaw = String(
    body?.status ||
    body?.Status ||
    url.searchParams.get("status") ||
    "pending"
  ).trim();

  try {
    await dbConnect();
    await WebhookEvent.create({
      provider: "paynow",
      receivedAt: new Date(),
      headers: Object.fromEntries(request.headers.entries()),
      payload: { params, body, query: Object.fromEntries(url.searchParams.entries()) },
    }).catch(() => null);

    if (reference) {
      await PaymentTransaction.updateOne(
        { reference },
        {
          $set: {
            status: mapStatus(statusRaw),
            ...(paynowReference ? { paynowReference } : {}),
          },
          $push: {
            verificationLogs: {
              success: true,
              status: statusRaw,
              paid: mapStatus(statusRaw) === "paid",
              message: `Webhook ${params?.event || "event"} received`,
              raw: { body, query: Object.fromEntries(url.searchParams.entries()) },
              createdAt: new Date(),
            },
          },
        },
      ).exec();
    }
  } catch {
  }

  return NextResponse.json({ ok: true });
}

export async function GET(request, { params }) {
  return handlePaynowWebhook(request, params);
}

export async function POST(request, { params }) {
  return handlePaynowWebhook(request, params);
}

