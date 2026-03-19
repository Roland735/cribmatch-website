// /lib/paynowEcocash.js
import crypto from "crypto";
import { dbConnect, getPricingSettings, PaymentTransaction } from "@/lib/db";

const PAYNOW_INTEGRATION_ID = process.env.PAYNOW_INTEGRATION_ID || "22925";
const PAYNOW_INTEGRATION_KEY = process.env.PAYNOW_INTEGRATION_KEY || "290c9058-50a4-4bbf-b999-d07c2cd46c44";
const PAYNOW_COMPANY = process.env.PAYNOW_COMPANY || "Omnirol";
const PAYNOW_PAYMENT_LINK_LABEL = process.env.PAYNOW_PAYMENT_LINK_LABEL || "Rentals App";
const CONTACT_UNLOCK_AMOUNT = Number(process.env.PAYNOW_CONTACT_UNLOCK_AMOUNT || 2.5);
const PAYNOW_CURRENCY = String(process.env.PAYNOW_CURRENCY || "USD").toUpperCase();
const BASE_URL = process.env.APP_BASE_URL || process.env.NEXTAUTH_URL || "https://cribmatch.app";
const PAYNOW_TEST_MODE = String(process.env.PAYNOW_TEST_MODE || "").toLowerCase() === "true";
const PAYNOW_TEST_NUMBER_BYPASS = String(process.env.PAYNOW_TEST_NUMBER_BYPASS || "true").toLowerCase() === "true";
const PAYNOW_TEST_SUCCESS_NUMBERS = (process.env.PAYNOW_TEST_SUCCESS_NUMBERS || "0771111111,263771111111")
  .split(",")
  .map((v) => String(v || "").replace(/\D/g, ""))
  .filter(Boolean);
const PAYNOW_TEST_NUMBER_SCENARIOS = String(
  process.env.PAYNOW_TEST_NUMBER_SCENARIOS ||
  "0771111111:success,0772222222:delayed:2,0773333333:failed,0774444444:cancelled"
)
  .split(",")
  .map((v) => String(v || "").trim())
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

function resolveTestScenario(local, international) {
  const localDigits = digitsOnly(local);
  const intlDigits = digitsOnly(international);
  for (const entry of PAYNOW_TEST_NUMBER_SCENARIOS) {
    const parts = entry.split(":").map((p) => String(p || "").trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const number = digitsOnly(parts[0]);
    if (!number) continue;
    if (number !== localDigits && number !== intlDigits) continue;
    if (parts[1].toLowerCase() === "delayed") {
      const checks = Number(parts[2] || 2);
      const safeChecks = Number.isFinite(checks) ? Math.max(1, Math.floor(checks)) : 2;
      return `delayed:${safeChecks}`;
    }
    return parts[1].toLowerCase();
  }
  if (isPaynowTestSuccessNumber(local, international)) return "success";
  return "";
}

function pickFirstNonEmptyValue(source, keys = []) {
  if (!source || typeof source !== "object") return "";
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

async function getPaynowClient() {
  let moduleRef = null;
  let PaynowCtorOrInstance = null;

  try {
    moduleRef = await import("paynow");
  } catch (importErr) {
    try {
      moduleRef = require("paynow");
    } catch (requireErr) {
      const msg = `Failed to load 'paynow' SDK via import or require. import error: ${importErr?.message || ""}; require error: ${requireErr?.message || ""}`;
      throw new Error(msg);
    }
  }

  try {
    console.log("paynow module keys:", Object.keys(moduleRef || {}));
    console.log("paynow moduleRef default exists?", !!(moduleRef && moduleRef.default));
  } catch (e) {
    // ignore logging issues
  }

  if (!moduleRef) {
    throw new Error("paynow module import returned falsy value");
  }

  if (typeof moduleRef.createPayment === "function" && typeof moduleRef.sendMobile === "function") {
    PaynowCtorOrInstance = moduleRef;
  } else if (moduleRef.default && typeof moduleRef.default === "function") {
    PaynowCtorOrInstance = moduleRef.default;
  } else if (moduleRef.Paynow && typeof moduleRef.Paynow === "function") {
    PaynowCtorOrInstance = moduleRef.Paynow;
  } else if (typeof moduleRef === "function") {
    PaynowCtorOrInstance = moduleRef;
  } else if (moduleRef.default && typeof moduleRef.default === "object" && typeof moduleRef.default.createPayment === "function") {
    PaynowCtorOrInstance = moduleRef.default;
  } else {
    console.error("Unexpected paynow module shape:", moduleRef);
    throw new Error("Unexpected 'paynow' SDK export shape. Inspect server logs.");
  }

  if (typeof PaynowCtorOrInstance === "object" && PaynowCtorOrInstance !== null) {
    try {
      const resultUrl = `${BASE_URL.replace(/\/+$/, "")}/api/webhooks/paynow/result`;
      const returnUrl = `${BASE_URL.replace(/\/+$/, "")}/api/webhooks/paynow/return`;
      PaynowCtorOrInstance.resultUrl = PaynowCtorOrInstance.resultUrl || resultUrl;
      PaynowCtorOrInstance.returnUrl = PaynowCtorOrInstance.returnUrl || returnUrl;
    } catch (e) {
      // ignore
    }
    return PaynowCtorOrInstance;
  }

  const PaynowCtor = PaynowCtorOrInstance;
  if (typeof PaynowCtor !== "function") {
    throw new Error("Resolved Paynow value is not a function or object instance");
  }

  const resultUrl = `${BASE_URL.replace(/\/+$/, "")}/api/webhooks/paynow/result`;
  const returnUrl = `${BASE_URL.replace(/\/+$/, "")}/api/webhooks/paynow/return`;

  let instance = null;
  try {
    instance = new PaynowCtor(PAYNOW_INTEGRATION_ID, PAYNOW_INTEGRATION_KEY, resultUrl, returnUrl);
  } catch (e1) {
    try {
      instance = new PaynowCtor(PAYNOW_INTEGRATION_ID, PAYNOW_INTEGRATION_KEY);
      instance.resultUrl = instance.resultUrl || resultUrl;
      instance.returnUrl = instance.returnUrl || returnUrl;
    } catch (e2) {
      try {
        instance = PaynowCtor(PAYNOW_INTEGRATION_ID, PAYNOW_INTEGRATION_KEY, resultUrl, returnUrl);
      } catch (e3) {
        const combined = `Could not construct Paynow client. errors: ${String(e1?.message || "")} | ${String(e2?.message || "")} | ${String(e3?.message || "")}`;
        console.error(combined);
        throw new Error("Failed to instantiate Paynow client. See server logs for details.");
      }
    }
  }

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
  const pricing = await getPricingSettings();
  const amountCandidate = Number.isFinite(Number(pricing?.contactUnlockPriceUsd))
    ? Number(pricing.contactUnlockPriceUsd)
    : (Number.isFinite(CONTACT_UNLOCK_AMOUNT) ? CONTACT_UNLOCK_AMOUNT : 2.5);
  const amount = Number.parseFloat(amountCandidate.toFixed(2));
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      ok: false,
      error: "invalid-amount",
      userMessage: "Payment amount is invalid. Please contact support.",
    };
  }

  const tx = await PaymentTransaction.create({
    phone: normalizedPhone,
    payerMobile: normalizedPayer.local,
    listingId,
    listingCode,
    listingTitle,
    amount,
    currency: PAYNOW_CURRENCY,
    gateway: "paynow_ecocash",
    status: "created",
    reference,
    integrationId: PAYNOW_INTEGRATION_ID,
    company: PAYNOW_COMPANY,
    paymentLinkLabel: PAYNOW_PAYMENT_LINK_LABEL,
  });

  const testScenario = resolveTestScenario(normalizedPayer.local, normalizedPayer.international);
  if (testScenario) {
    await addAttemptLog(tx._id, {
      stage: "ussd_push",
      success: true,
      message: `PAYNOW_TEST_MODE simulated USSD: ${testScenario}`,
      code: "TEST_MODE_PUSH_INITIATED",
      raw: { mode: "test", payerMobile: normalizedPayer.local, scenario: testScenario },
    });
    await PaymentTransaction.updateOne(
      { _id: tx._id },
      {
        $set: {
          status: "pending_confirmation",
          pollUrl: `test://paynow/${testScenario}/${reference}`,
          paynowReference: `TEST-${reference}`,
          retriesUsed: 0,
        },
      },
    ).exec();
    return {
      ok: true,
      transactionId: String(tx._id),
      reference,
      amount,
      pollUrl: `test://paynow/${testScenario}/${reference}`,
      retriesUsed: 0,
      instructions: testScenario.startsWith("delayed")
        ? "Test mode delayed scenario: wait for auto confirmation."
        : `Test mode scenario: ${testScenario}.`,
    };
  }

  const payerEmail = `${normalizedPhone || normalizedPayer.local}@cribmatch.co.zw`;
  let lastPushErrorMessage = "Push failed";
  let fatalInitializationError = false;

  for (let attempt = 0; attempt <= maxPushRetries; attempt += 1) {
    try {
      const paynow = await getPaynowClient();

      // create payment: try to force currency to PAYNOW_CURRENCY in a backwards-compatible way,
      // then add the item. Different SDK versions expose different APIs:
      // - payment.setCurrency("USD")
      // - payment.currency = "USD"
      // - payment.add(description, amount, "USD")
      // We attempt these in order and fall back to including the currency in the item description if none work.
      const payment = paynow.createPayment(reference, payerEmail);

      try {
        // preferred API
        if (typeof payment.setCurrency === "function") {
          payment.setCurrency(PAYNOW_CURRENCY);
        } else if ("currency" in payment) {
          payment.currency = PAYNOW_CURRENCY;
        } else if (typeof paynow.setCurrency === "function") {
          paynow.setCurrency(PAYNOW_CURRENCY);
        }
      } catch (e) {
        // non-fatal; continue to other options
        console.warn("Could not set currency via setCurrency/currency property:", e?.message || e);
      }

      payment.add(`${PAYNOW_PAYMENT_LINK_LABEL} - ${listingTitle}`, amount, 1);

      // sendMobile may return different shapes depending on SDK; capture it
      const response = await paynow.sendMobile(payment, normalizedPayer.local, "ecocash");

      const pollUrl = pickFirstNonEmptyValue(response, ["pollUrl", "PollUrl", "pollurl", "pollURL", "poll_url"]);
      const paynowReference = pickFirstNonEmptyValue(response, ["reference", "paynowreference", "paynowReference", "reference_id", "Reference"]);
      const sdkMarkedSuccess = Boolean(response?.success) || Boolean(response?.Success);
      const hasTrackingReference = Boolean(pollUrl || paynowReference);
      const success = Boolean(response && (sdkMarkedSuccess || !response.error)) && hasTrackingReference;
      const missingTrackingHint = !hasTrackingReference
        ? "Payment gateway response is missing poll URL/reference."
        : "";

      await addAttemptLog(tx._id, {
        stage: "ussd_push",
        success,
        message: success
          ? "USSD push initiated"
          : String(response?.error || response?.message || response?.Message || missingTrackingHint || "Push failed"),
        code: success ? "PUSH_INITIATED" : "PUSH_FAILED",
        raw: response || null,
      });

      if (!success) {
        lastPushErrorMessage = String(response?.error || response?.message || response?.Message || missingTrackingHint || "Push failed");
      }

      if (success) {
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
          amount,
          pollUrl,
          retriesUsed: attempt,
          instructions: String(response?.instructions || response?.message || response?.Message || `Approve the ${PAYNOW_CURRENCY} EcoCash USSD prompt on your phone to complete payment.`),
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
    if (String(tx.status || "").toLowerCase() === "paid") {
      return { ok: true, paid: true, status: "paid", transaction: tx };
    }
    if (String(tx.status || "").toLowerCase().includes("cancel")) {
      return { ok: true, paid: false, status: "cancelled", transaction: tx };
    }
    if (String(tx.status || "").toLowerCase().includes("fail")) {
      return { ok: true, paid: false, status: "failed", transaction: tx };
    }
    await addVerificationLog(tx._id, {
      success: true,
      status: "pending_no_poll_url",
      paid: false,
      message: "Missing poll URL; awaiting webhook status update",
      raw: null,
    });
    return { ok: true, paid: false, status: String(tx.status || "pending_confirmation"), transaction: tx };
  }

  if (String(tx.pollUrl || "").startsWith("test://paynow/")) {
    const parts = String(tx.pollUrl || "").replace("test://paynow/", "").split("/").filter(Boolean);
    const scenario = String(parts[0] || "success").toLowerCase();
    const testPollCount = Array.isArray(tx.verificationLogs)
      ? tx.verificationLogs.filter((l) => l?.raw?.mode === "test").length
      : 0;
    if (scenario.startsWith("delayed")) {
      const checksRaw = scenario.split(":")[1];
      const checksRequired = Number.isFinite(Number(checksRaw)) ? Math.max(1, Number(checksRaw)) : 2;
      if (testPollCount < checksRequired) {
        await addVerificationLog(tx._id, {
          success: true,
          status: "pending",
          paid: false,
          message: `PAYNOW_TEST_MODE delayed pending (${testPollCount + 1}/${checksRequired})`,
          raw: { mode: "test", pollUrl: tx.pollUrl, scenario },
        });
        await PaymentTransaction.updateOne({ _id: tx._id }, { $set: { status: "pending_confirmation" } }).exec();
        return { ok: true, paid: false, status: "pending", transaction: tx };
      }
      await addVerificationLog(tx._id, {
        success: true,
        status: "paid",
        paid: true,
        message: "PAYNOW_TEST_MODE delayed now paid",
        raw: { mode: "test", pollUrl: tx.pollUrl, scenario },
      });
      await PaymentTransaction.updateOne(
        { _id: tx._id },
        { $set: { status: "paid", unlockedAt: new Date() } },
      ).exec();
      return { ok: true, paid: true, status: "paid", transaction: tx };
    }
    if (scenario === "failed") {
      await addVerificationLog(tx._id, {
        success: true,
        status: "failed",
        paid: false,
        message: "PAYNOW_TEST_MODE failed scenario",
        raw: { mode: "test", pollUrl: tx.pollUrl, scenario },
      });
      await PaymentTransaction.updateOne({ _id: tx._id }, { $set: { status: "failed" } }).exec();
      return { ok: true, paid: false, status: "failed", transaction: tx };
    }
    if (scenario === "cancelled") {
      await addVerificationLog(tx._id, {
        success: true,
        status: "cancelled",
        paid: false,
        message: "PAYNOW_TEST_MODE cancelled scenario",
        raw: { mode: "test", pollUrl: tx.pollUrl, scenario },
      });
      await PaymentTransaction.updateOne({ _id: tx._id }, { $set: { status: "cancelled" } }).exec();
      return { ok: true, paid: false, status: "cancelled", transaction: tx };
    }
    await addVerificationLog(tx._id, {
      success: true,
      status: "paid",
      paid: true,
      message: "PAYNOW_TEST_MODE simulated paid result",
      raw: { mode: "test", pollUrl: tx.pollUrl, scenario },
    });
    await PaymentTransaction.updateOne(
      { _id: tx._id },
      { $set: { status: "paid", unlockedAt: new Date() } },
    ).exec();
    return { ok: true, paid: true, status: "paid", transaction: tx };
  }

  try {
    const paynow = await getPaynowClient();
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
