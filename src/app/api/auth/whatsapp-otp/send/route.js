import crypto from "crypto";
import Message from "@/lib/Message";
import { dbConnect, Listing, OtpChallenge, Purchase, User } from "@/lib/db";
import { normalizePhoneNumber, normalizePhoneNumberCandidates } from "@/lib/auth";

export const runtime = "nodejs";

const OTP_TTL_MINUTES = 10;
const OTP_SEND_COOLDOWN_SECONDS = 45;

function digitsOnly(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

function createOtpCode() {
  const value = crypto.randomInt(0, 1000000);
  return String(value).padStart(6, "0");
}

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

async function hashOtp(code) {
  const salt = crypto.randomBytes(16).toString("base64");
  const key = await scryptAsync(code, salt);
  return { salt, hash: key.toString("base64") };
}

function toDigitsCandidates(candidates = []) {
  return Array.from(
    new Set(
      candidates
        .map((value) => digitsOnly(value))
        .filter(Boolean),
    ),
  );
}

async function hasWhatsappHistory(phoneCandidates, digitsCandidates) {
  const [messageExists, listingExists, purchaseExists] = await Promise.all([
    digitsCandidates.length ? Message.exists({ phone: { $in: digitsCandidates } }) : null,
    Listing.exists({ listerPhoneNumber: { $in: phoneCandidates } }),
    Purchase.exists({ phone: { $in: [...phoneCandidates, ...digitsCandidates] } }),
  ]);
  return Boolean(messageExists || listingExists || purchaseExists);
}

// Builds all payload variants to try for a given template name + language.
// We try 4 structures in order:
//   1. Authentication template format (button with otp_type: "COPY_CODE")
//   2. Body-only with a single text parameter (most common custom template)
//   3. Body + URL button parameter (some templates use this)
//   4. No parameters at all (static template)
function buildPayloadVariants(phone, templateName, languageCode, code) {
  const to = digitsOnly(phone);
  const base = {
    messaging_product: "whatsapp",
    to,
    type: "template",
  };

  return [
    // 1. Authentication / OTP template (Meta's built-in OTP category)
    {
      ...base,
      template: {
        name: templateName,
        language: { code: languageCode },
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: code }],
          },
          {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: code }],
          },
        ],
      },
    },
    // 2. Body-only with one text parameter (standard custom template)
    {
      ...base,
      template: {
        name: templateName,
        language: { code: languageCode },
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: code }],
          },
        ],
      },
    },
    // 3. Authentication template with COPY_CODE button (newer Meta OTP templates)
    {
      ...base,
      template: {
        name: templateName,
        language: { code: languageCode },
        components: [
          {
            type: "button",
            sub_type: "COPY_CODE",
            index: "0",
            parameters: [{ type: "coupon_code", coupon_code: code }],
          },
        ],
      },
    },
    // 4. No parameters — static template
    {
      ...base,
      template: {
        name: templateName,
        language: { code: languageCode },
      },
    },
  ];
}

async function sendTemplateCode(phone, code) {
  const apiToken = process.env.WHATSAPP_API_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;

  // Language hardcoded to en_US (English US) — change here if the template language ever changes
  const TEMPLATE_NAME = "cribmatch_verification_code";
  const LANGUAGE_CODE = "en_US";

  if (!apiToken || !phoneNumberId) {
    return { ok: false, error: "WhatsApp credentials are missing" };
  }

  const url = `https://graph.facebook.com/v24.0/${phoneNumberId}/messages`;

  const payloadVariants = buildPayloadVariants(phone, TEMPLATE_NAME, LANGUAGE_CODE, code);

  let lastError = "";
  for (const payload of payloadVariants) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json().catch(() => ({}));

    if (response.ok && !result?.error) {
      return { ok: true };
    }

    const errorCode = result?.error?.code;
    const errorMessage =
      result?.error?.message ||
      result?.error?.error_data?.details ||
      "Failed to send WhatsApp verification code";

    lastError = `[${errorCode}] ${errorMessage}`;

    // Error 132000 = template param mismatch — try next variant
    // Error 132001 = template not found / lang mismatch — keep trying
    // Any other error class (auth, rate limit, etc.) — fail fast
    const isTemplateStructureError = [132000, 132001, 132012, 132015].includes(errorCode);
    if (!isTemplateStructureError) {
      return { ok: false, error: lastError };
    }
  }

  return {
    ok: false,
    error: `All payload variants failed. Last error: ${lastError}. Template: ${TEMPLATE_NAME}, Language: ${LANGUAGE_CODE}. Check the template body parameter count and button type in WhatsApp Manager.`,
  };
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const phoneNumber = normalizePhoneNumber(body?.phoneNumber);
  const purpose = String(body?.purpose || "");
  if (!phoneNumber) {
    return Response.json({ error: "Phone number is required" }, { status: 400 });
  }
  if (!["signup", "reset_password", "first_web_login"].includes(purpose)) {
    return Response.json({ error: "Invalid verification purpose" }, { status: 400 });
  }

  await dbConnect();

  const phoneCandidates = normalizePhoneNumberCandidates(phoneNumber);
  const digitsCandidates = toDigitsCandidates(phoneCandidates);
  const existingUser = await User.findOne({ _id: { $in: phoneCandidates } }).lean();

  if (purpose === "signup" && existingUser) {
    return Response.json({ error: "Phone number already registered" }, { status: 409 });
  }
  if (purpose === "reset_password" && !existingUser) {
    return Response.json({ error: "No account found for this phone number" }, { status: 404 });
  }
  if (purpose === "first_web_login") {
    const historyExists = await hasWhatsappHistory(phoneCandidates, digitsCandidates);
    if (!existingUser && !historyExists) {
      return Response.json(
        { error: "No previous WhatsApp activity found for this number" },
        { status: 404 },
      );
    }
  }

  const existingChallenge = await OtpChallenge.findOne({ phone: phoneNumber, purpose }).lean();
  const now = Date.now();
  if (existingChallenge?.lastSentAt) {
    const secondsSinceSend = (now - new Date(existingChallenge.lastSentAt).getTime()) / 1000;
    if (secondsSinceSend < OTP_SEND_COOLDOWN_SECONDS) {
      return Response.json(
        { error: `Please wait ${Math.ceil(OTP_SEND_COOLDOWN_SECONDS - secondsSinceSend)} seconds before requesting another code` },
        { status: 429 },
      );
    }
  }

  const code = createOtpCode();
  const codeRecord = await hashOtp(code);
  const expiresAt = new Date(now + OTP_TTL_MINUTES * 60 * 1000);

  const sendResult = await sendTemplateCode(phoneNumber, code);
  if (!sendResult.ok) {
    return Response.json({ error: sendResult.error }, { status: 502 });
  }

  await OtpChallenge.findOneAndUpdate(
    { phone: phoneNumber, purpose },
    {
      $set: {
        codeSalt: codeRecord.salt,
        codeHash: codeRecord.hash,
        expiresAt,
        usedAt: null,
        attempts: 0,
        lastSentAt: new Date(),
      },
      $inc: { sendCount: 1 },
    },
    { upsert: true, setDefaultsOnInsert: true, new: true },
  );

  return Response.json({ ok: true, expiresInMinutes: OTP_TTL_MINUTES });
}
