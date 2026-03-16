import crypto from "crypto";
import { dbConnect, PaymentTransaction } from "@/lib/db";

const PAYNOW_INTEGRATION_ID = process.env.PAYNOW_INTEGRATION_ID || "22925";
const PAYNOW_INTEGRATION_KEY = process.env.PAYNOW_INTEGRATION_KEY || "290c9058-50a4-4bbf-b999-d07c2cd46c44";
const PAYNOW_COMPANY = process.env.PAYNOW_COMPANY || "Omnirol";
const PAYNOW_PAYMENT_LINK_LABEL = process.env.PAYNOW_PAYMENT_LINK_LABEL || "Rentals App";
const CONTACT_UNLOCK_AMOUNT = Number(process.env.PAYNOW_CONTACT_UNLOCK_AMOUNT || 1);
const BASE_URL = process.env.APP_BASE_URL || process.env.NEXTAUTH_URL || "https://cribmatch.app";

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

export function normalizeZimbabweMobile(input) {
  const raw = digitsOnly(input);
  if (/^2637[1-8]\d{7}$/.test(raw)) {
    return { valid: true, local: `0${raw.slice(3)}`, international: raw };
  }
  if (/^07[1-8]\d{7}$/.test(raw)) {
    return { valid: true, local: raw, international: `263${raw.slice(1)}` };
  }
  if (/^7[1-8]\d{7}$/.test(raw)) {
    return { valid: true, local: `0${raw}`, international: `263${raw}` };
  }
  return { valid: false, local: "", international: "" };
}

function buildReference(listingCode = "") {
  const code = String(listingCode || "RENT").replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 6) || "RENT";
  const nonce = crypto.randomBytes(2).toString("hex").toUpperCase();
  const ts = Date.now().toString(36).toUpperCase();
  return `CM-${code}-${ts}-${nonce}`;
}

async function getPaynowClient() {
  const moduleRef = await import("paynow");
  const PaynowCtor = moduleRef?.default || moduleRef?.Paynow || moduleRef;
  const paynow = new PaynowCtor(PAYNOW_INTEGRATION_ID, PAYNOW_INTEGRATION_KEY);
  paynow.resultUrl = `${BASE_URL.replace(/\/+$/, "")}/api/webhooks/paynow/result`;
  paynow.returnUrl = `${BASE_URL.replace(/\/+$/, "")}/api/webhooks/paynow/return`;
  return paynow;
}

async function addAttemptLog(transactionId, payload) {
  await PaymentTransaction.updateOne(
    { _id: transactionId },
    { $push: { attemptLogs: { ...payload, createdAt: new Date() } } },
  ).exec();
}

async function addVerificationLog(transactionId, payload) {
  await PaymentTransaction.updateOne(
    { _id: transactionId },
    { $push: { verificationLogs: { ...payload, createdAt: new Date() } } },
  ).exec();
}

export async function initiatePaynowEcocashPayment({ phone, payerMobile, listing, maxPushRetries = 2 }) {
  await dbConnect();

  const normalizedPhone = digitsOnly(phone);
  const normalizedPayer = normalizeZimbabweMobile(payerMobile);
  if (!normalizedPayer.valid) {
    return { ok: false, error: "invalid-mobile", userMessage: "Invalid Zimbabwe mobile number format." };
  }

  const listingId = String(listing?._id || listing?.id || "");
  const listingCode = String(listing?.shortId || "").toUpperCase();
  const listingTitle = String(listing?.title || "Property listing");
  const reference = buildReference(listingCode);
  const amount = Number.isFinite(CONTACT_UNLOCK_AMOUNT) ? CONTACT_UNLOCK_AMOUNT : 1;

  const tx = await PaymentTransaction.create({
    phone: normalizedPhone,
    payerMobile: normalizedPayer.local,
    listingId,
    listingCode,
    listingTitle,
    amount,
    currency: "USD",
    gateway: "paynow_ecocash",
    status: "created",
    reference,
    integrationId: PAYNOW_INTEGRATION_ID,
    company: PAYNOW_COMPANY,
    paymentLinkLabel: PAYNOW_PAYMENT_LINK_LABEL,
  });

  const payerEmail = `${normalizedPhone || normalizedPayer.local}@cribmatch.co.zw`;

  for (let attempt = 0; attempt <= maxPushRetries; attempt += 1) {
    try {
      const paynow = await getPaynowClient();
      const payment = paynow.createPayment(reference, payerEmail);
      payment.add(`${PAYNOW_PAYMENT_LINK_LABEL} - ${listingTitle}`, amount);
      const response = await paynow.sendMobile(payment, normalizedPayer.local, "ecocash");
      const success = Boolean(response?.success);

      await addAttemptLog(tx._id, {
        stage: "ussd_push",
        success,
        message: success ? "USSD push initiated" : String(response?.error || response?.message || "Push failed"),
        code: success ? "PUSH_INITIATED" : "PUSH_FAILED",
        raw: response || null,
      });

      if (success) {
        const pollUrl = String(response?.pollUrl || "");
        const paynowReference = String(response?.reference || response?.paynowreference || "");
        await PaymentTransaction.updateOne(
          { _id: tx._id },
          {
            $set: {
              status: "pending_confirmation",
              pollUrl,
              paynowReference,
              retriesUsed: attempt,
            },
          },
        ).exec();

        return {
          ok: true,
          transactionId: String(tx._id),
          reference,
          pollUrl,
          retriesUsed: attempt,
          instructions: String(response?.instructions || "Approve the EcoCash USSD prompt on your phone to complete payment."),
        };
      }
    } catch (error) {
      await addAttemptLog(tx._id, {
        stage: "ussd_push",
        success: false,
        message: String(error?.message || "USSD push error"),
        code: "PUSH_ERROR",
        raw: { name: error?.name || "", stack: error?.stack || "" },
      });
    }
  }

  await PaymentTransaction.updateOne(
    { _id: tx._id },
    { $set: { status: "push_failed", retriesUsed: maxPushRetries + 1 } },
  ).exec();

  return {
    ok: false,
    transactionId: String(tx._id),
    reference,
    error: "ussd-push-failed",
    userMessage: "We could not send the EcoCash USSD prompt right now. Please retry in a moment.",
  };
}

export async function verifyPaynowPayment(transactionId) {
  await dbConnect();
  const tx = await PaymentTransaction.findById(transactionId).lean().exec();
  if (!tx) {
    return { ok: false, error: "not-found", userMessage: "Payment transaction not found." };
  }

  if (!tx.pollUrl) {
    await addVerificationLog(tx._id, {
      success: false,
      status: "unknown",
      paid: false,
      message: "Missing poll URL",
      raw: null,
    });
    await PaymentTransaction.updateOne({ _id: tx._id }, { $set: { status: "verification_failed" } }).exec();
    return { ok: false, error: "missing-poll-url", userMessage: "Payment is pending setup. Please retry." };
  }

  try {
    const paynow = await getPaynowClient();
    const pollResponse = await paynow.pollTransaction(tx.pollUrl);
    const status = String(pollResponse?.status || pollResponse?.Status || "unknown");
    const statusLower = status.toLowerCase();
    const paid = Boolean(pollResponse?.paid) || statusLower === "paid" || statusLower === "awaiting delivery" || statusLower === "delivered";
    const cancelled = statusLower.includes("cancel");
    const failed = statusLower.includes("fail") || statusLower.includes("error");

    await addVerificationLog(tx._id, {
      success: true,
      status,
      paid,
      message: String(pollResponse?.instructions || pollResponse?.message || ""),
      raw: pollResponse || null,
    });

    if (paid) {
      await PaymentTransaction.updateOne(
        { _id: tx._id },
        { $set: { status: "paid", unlockedAt: new Date() } },
      ).exec();
      return { ok: true, paid: true, status, transaction: tx };
    }

    if (cancelled) {
      await PaymentTransaction.updateOne({ _id: tx._id }, { $set: { status: "cancelled" } }).exec();
      return { ok: true, paid: false, status, transaction: tx };
    }

    if (failed) {
      await PaymentTransaction.updateOne({ _id: tx._id }, { $set: { status: "failed" } }).exec();
      return { ok: true, paid: false, status, transaction: tx };
    }

    await PaymentTransaction.updateOne({ _id: tx._id }, { $set: { status: "pending_confirmation" } }).exec();
    return { ok: true, paid: false, status, transaction: tx };
  } catch (error) {
    await addVerificationLog(tx._id, {
      success: false,
      status: "verification_error",
      paid: false,
      message: String(error?.message || "Verification error"),
      raw: { name: error?.name || "", stack: error?.stack || "" },
    });
    await PaymentTransaction.updateOne({ _id: tx._id }, { $set: { status: "verification_failed" } }).exec();
    return { ok: false, error: "verification-error", userMessage: "Could not confirm payment right now. Please try again shortly." };
  }
}

export async function getLatestSuccessfulPayment(phone, listingId) {
  await dbConnect();
  return PaymentTransaction.findOne({
    phone: digitsOnly(phone),
    listingId: String(listingId || ""),
    status: "paid",
  })
    .sort({ updatedAt: -1 })
    .lean()
    .exec();
}

