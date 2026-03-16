// /lib/paynowEcocash.js
import crypto from "crypto";
import { dbConnect, PaymentTransaction } from "@/lib/db";

const PAYNOW_INTEGRATION_ID = process.env.PAYNOW_INTEGRATION_ID || "22925";
const PAYNOW_INTEGRATION_KEY = process.env.PAYNOW_INTEGRATION_KEY || "290c9058-50a4-4bbf-b999-d07c2cd46c44";
const PAYNOW_COMPANY = process.env.PAYNOW_COMPANY || "Omnirol";
const PAYNOW_PAYMENT_LINK_LABEL = process.env.PAYNOW_PAYMENT_LINK_LABEL || "Rentals App";
const CONTACT_UNLOCK_AMOUNT = Number(process.env.PAYNOW_CONTACT_UNLOCK_AMOUNT || 1);
const BASE_URL = process.env.APP_BASE_URL || process.env.NEXTAUTH_URL || "https://cribmatch.app";
const PAYNOW_TEST_MODE = String(process.env.PAYNOW_TEST_MODE || "").toLowerCase() === "true";
const PAYNOW_TEST_NUMBER_BYPASS = String(process.env.PAYNOW_TEST_NUMBER_BYPASS || "true").toLowerCase() === "true";
const PAYNOW_TEST_SUCCESS_NUMBERS = (process.env.PAYNOW_TEST_SUCCESS_NUMBERS || "0771111111,263771111111")
  .split(",")
  .map((v) => String(v || "").replace(/\D/g, ""))
  .filter(Boolean);

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

function isPaynowTestSuccessNumber(local, international) {
  if (!PAYNOW_TEST_MODE && !PAYNOW_TEST_NUMBER_BYPASS) return false;
  const localDigits = digitsOnly(local);
  const intlDigits = digitsOnly(international);
  return PAYNOW_TEST_SUCCESS_NUMBERS.includes(localDigits) || PAYNOW_TEST_SUCCESS_NUMBERS.includes(intlDigits);
}

async function getPaynowClient() {
  // Robust dynamic import / require fallback and constructor detection.
  // This should avoid "is not a constructor" issues across SDK versions.
  let moduleRef = null;
  let PaynowCtorOrInstance = null;

  try {
    // preferred: ESM dynamic import
    // NOTE: in some runtimes this returns { default: [Function] } or the function directly.
    // We inspect returned shape and handle common shapes.
    moduleRef = await import("paynow");
  } catch (importErr) {
    try {
      // fallback to require (CommonJS)
      // (Only works if runtime allows require)
      moduleRef = require("paynow");
    } catch (requireErr) {
      const msg = `Failed to load 'paynow' SDK via import or require. import error: ${importErr?.message || ""}; require error: ${requireErr?.message || ""}`;
      // throw a clear error to help debugging
      throw new Error(msg);
    }
  }

  // moduleRef might be:
  // - the constructor function itself
  // - { default: constructor }
  // - { Paynow: constructor }
  // - an already-instantiated client (object with createPayment/sendMobile)
  // - other shapes (we will throw helpful error)
  // inspect:
  try {
    // Helpful debug info — the logs will appear in your server console when this runs
    // (Comment out in production if noisy)
    console.log("paynow module keys:", Object.keys(moduleRef || {}));
    console.log("paynow moduleRef default exists?", !!(moduleRef && moduleRef.default));
  } catch (e) {
    // ignore logging issues
  }

  // Resolve candidate ctor or instance:
  if (!moduleRef) {
    throw new Error("paynow module import returned falsy value");
  }

  // If moduleRef looks like an instance (has createPayment & sendMobile) use it directly
  if (typeof moduleRef.createPayment === "function" && typeof moduleRef.sendMobile === "function") {
    PaynowCtorOrInstance = moduleRef;
  } else if (moduleRef.default && typeof moduleRef.default === "function") {
    // default export is constructor
    PaynowCtorOrInstance = moduleRef.default;
  } else if (moduleRef.Paynow && typeof moduleRef.Paynow === "function") {
    PaynowCtorOrInstance = moduleRef.Paynow;
  } else if (typeof moduleRef === "function") {
    PaynowCtorOrInstance = moduleRef;
  } else if (moduleRef.default && typeof moduleRef.default === "object" && typeof moduleRef.default.createPayment === "function") {
    PaynowCtorOrInstance = moduleRef.default;
  } else {
    // not recognized
    console.error("Unexpected paynow module shape:", moduleRef);
    throw new Error("Unexpected 'paynow' SDK export shape. Inspect server logs.");
  }

  // If we resolved an instance (object with createPayment), return it directly.
  if (typeof PaynowCtorOrInstance === "object" && PaynowCtorOrInstance !== null) {
    // But ensure resultUrl/returnUrl are present on the instance if SDK expects them
    try {
      const resultUrl = `${BASE_URL.replace(/\/+$/, "")}/api/webhooks/paynow/result`;
      const returnUrl = `${BASE_URL.replace(/\/+$/, "")}/api/webhooks/paynow/return`;
      // attach if properties exist or set anyway (harmless)
      PaynowCtorOrInstance.resultUrl = PaynowCtorOrInstance.resultUrl || resultUrl;
      PaynowCtorOrInstance.returnUrl = PaynowCtorOrInstance.returnUrl || returnUrl;
    } catch (e) {
      // ignore
    }
    return PaynowCtorOrInstance;
  }

  // Otherwise we have a constructor function — try to instantiate.
  const PaynowCtor = PaynowCtorOrInstance;
  if (typeof PaynowCtor !== "function") {
    throw new Error("Resolved Paynow value is not a function or object instance");
  }

  // Try common constructor signatures:
  // 1) new Paynow(integrationId, integrationKey, resultUrl, returnUrl)
  // 2) new Paynow(integrationId, integrationKey) and then set .resultUrl/.returnUrl
  const resultUrl = `${BASE_URL.replace(/\/+$/, "")}/api/webhooks/paynow/result`;
  const returnUrl = `${BASE_URL.replace(/\/+$/, "")}/api/webhooks/paynow/return`;

  let instance = null;
  try {
    instance = new PaynowCtor(PAYNOW_INTEGRATION_ID, PAYNOW_INTEGRATION_KEY, resultUrl, returnUrl);
  } catch (e1) {
    try {
      instance = new PaynowCtor(PAYNOW_INTEGRATION_ID, PAYNOW_INTEGRATION_KEY);
      // attach urls if SDK expects them as properties
      instance.resultUrl = instance.resultUrl || resultUrl;
      instance.returnUrl = instance.returnUrl || returnUrl;
    } catch (e2) {
      // last-ditch: call as function (some rare SDKs return factory)
      try {
        instance = PaynowCtor(PAYNOW_INTEGRATION_ID, PAYNOW_INTEGRATION_KEY, resultUrl, returnUrl);
      } catch (e3) {
        // give maximum context in error
        const combined = `Could not construct Paynow client. errors: ${String(e1?.message || "")} | ${String(e2?.message || "")} | ${String(e3?.message || "")}`;
        console.error(combined);
        throw new Error("Failed to instantiate Paynow client. See server logs for details.");
      }
    }
  }

  // final sanity checks
  if (!instance || typeof instance.createPayment !== "function" || typeof instance.sendMobile !== "function") {
    console.error("Constructed paynow instance missing expected methods:", instance);
    throw new Error("Paynow client missing expected methods (createPayment/sendMobile).");
  }

  return instance;
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

  if (isPaynowTestSuccessNumber(normalizedPayer.local, normalizedPayer.international)) {
    await addAttemptLog(tx._id, {
      stage: "ussd_push",
      success: true,
      message: "PAYNOW_TEST_MODE simulated USSD success",
      code: "TEST_MODE_PUSH_INITIATED",
      raw: { mode: "test", payerMobile: normalizedPayer.local },
    });
    await PaymentTransaction.updateOne(
      { _id: tx._id },
      {
        $set: {
          status: "pending_confirmation",
          pollUrl: "test://paynow/success",
          paynowReference: `TEST-${reference}`,
          retriesUsed: 0,
        },
      },
    ).exec();
    return {
      ok: true,
      transactionId: String(tx._id),
      reference,
      pollUrl: "test://paynow/success",
      retriesUsed: 0,
      instructions: "Test mode success number detected. Reply 'paid' to confirm and unlock contact details.",
    };
  }

  const payerEmail = `${normalizedPhone || normalizedPayer.local}@cribmatch.co.zw`;
  let lastPushErrorMessage = "Push failed";
  let fatalInitializationError = false;

  for (let attempt = 0; attempt <= maxPushRetries; attempt += 1) {
    try {
      const paynow = await getPaynowClient();

      // create payment and attach item
      const payment = paynow.createPayment(reference, payerEmail);
      payment.add(`${PAYNOW_PAYMENT_LINK_LABEL} - ${listingTitle}`, amount);

      // sendMobile may return different shapes depending on SDK; capture it
      const response = await paynow.sendMobile(payment, normalizedPayer.local, "ecocash");

      // Normalize response success detection
      const success = Boolean(response?.success) || Boolean(response?.Success) || (response && !response.error && (response.pollUrl || response.reference));

      await addAttemptLog(tx._id, {
        stage: "ussd_push",
        success,
        message: success ? "USSD push initiated" : String(response?.error || response?.message || response?.Message || "Push failed"),
        code: success ? "PUSH_INITIATED" : "PUSH_FAILED",
        raw: response || null,
      });

      if (!success) {
        lastPushErrorMessage = String(response?.error || response?.message || response?.Message || "Push failed");
      }

      if (success) {
        const pollUrl = String(response?.pollUrl || response?.PollUrl || "");
        const paynowReference = String(response?.reference || response?.paynowreference || response?.reference_id || response?.paynowReference || "");
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
          instructions: String(response?.instructions || response?.message || response?.Message || "Approve the EcoCash USSD prompt on your phone to complete payment."),
        };
      }
    } catch (error) {
      lastPushErrorMessage = String(error?.message || "USSD push error");
      await addAttemptLog(tx._id, {
        stage: "ussd_push",
        success: false,
        message: String(error?.message || "USSD push error"),
        code: "PUSH_ERROR",
        raw: { name: error?.name || "", stack: error?.stack || "" },
      });
      if (/not a constructor|Failed to instantiate Paynow client|missing expected methods/i.test(lastPushErrorMessage)) {
        fatalInitializationError = true;
        break;
      }
      // small delay could help transient issues (optional)
      // await new Promise(res => setTimeout(res, 300)); // uncomment if desired
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
    userMessage: fatalInitializationError
      ? "Payment gateway initialization failed. Sandbox number bypass is enabled for test numbers; use 0771111111 or contact support."
      : `We could not send the EcoCash USSD prompt right now. ${lastPushErrorMessage}`.slice(0, 240),
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

  if (String(tx.pollUrl || "").startsWith("test://paynow/success")) {
    await addVerificationLog(tx._id, {
      success: true,
      status: "paid",
      paid: true,
      message: "PAYNOW_TEST_MODE simulated paid result",
      raw: { mode: "test", pollUrl: tx.pollUrl },
    });
    await PaymentTransaction.updateOne(
      { _id: tx._id },
      { $set: { status: "paid", unlockedAt: new Date() } },
    ).exec();
    return { ok: true, paid: true, status: "paid", transaction: tx };
  }

  try {
    const paynow = await getPaynowClient();
    // different SDKs expose different poll functions — most use pollTransaction(pollUrl)
    // We'll try pollTransaction, and fallback to poll or checkTransaction if available.
    let pollResponse = null;
    if (typeof paynow.pollTransaction === "function") {
      pollResponse = await paynow.pollTransaction(tx.pollUrl);
    } else if (typeof paynow.poll === "function") {
      pollResponse = await paynow.poll(tx.pollUrl);
    } else if (typeof paynow.checkTransaction === "function") {
      pollResponse = await paynow.checkTransaction(tx.pollUrl);
    } else {
      throw new Error("Paynow client missing pollTransaction/poll/checkTransaction method");
    }

    const status = String(pollResponse?.status || pollResponse?.Status || pollResponse?.statusDescription || "unknown");
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
