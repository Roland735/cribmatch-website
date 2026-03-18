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

async function sendTemplateCode(phone, code) {
  const apiToken = process.env.WHATSAPP_API_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;
  const configuredTemplateName = process.env.WHATSAPP_AUTH_TEMPLATE_NAME || "cribmatch_verification_code";
  const configuredLanguageCode = process.env.WHATSAPP_AUTH_TEMPLATE_LANG || "en_US";
  const templateNames = Array.from(
    new Set(
      [
        ...String(process.env.WHATSAPP_AUTH_TEMPLATE_NAMES || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        configuredTemplateName,
      ],
    ),
  );
  const languageCodes = Array.from(
    new Set(
      [
        ...String(process.env.WHATSAPP_AUTH_TEMPLATE_LANGS || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        configuredLanguageCode,
        "en_US",
        "en",
      ],
    ),
  );

  if (!apiToken || !phoneNumberId) {
    return { ok: false, error: "WhatsApp credentials are missing" };
  }

  async function graphGet(path) {
    const response = await fetch(`https://graph.facebook.com/v24.0/${path}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
    });
    return response.json().catch(() => ({}));
  }

  async function getTemplateDiagnostics(name) {
    const phoneInfo = await graphGet(`${phoneNumberId}?fields=id,display_phone_number,verified_name`);
    const explicitWabaId = String(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "").trim();
    const wabaId = explicitWabaId;
    if (!wabaId) {
      return {
        wabaId: "",
        matchedTemplate: null,
        phoneLinkedToWaba: null,
        displayPhoneNumber: phoneInfo?.display_phone_number || "",
        verifiedName: phoneInfo?.verified_name || "",
        phoneInfoError:
          phoneInfo?.error?.message ||
          phoneInfo?.error?.error_user_msg ||
          phoneInfo?.error?.error_data?.details ||
          "WHATSAPP_BUSINESS_ACCOUNT_ID is not set",
      };
    }
    const templates = await graphGet(
      `${wabaId}/message_templates?name=${encodeURIComponent(name)}&fields=name,status,language,category`,
    );
    const phoneNumbers = await graphGet(
      `${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`,
    );
    const matchedTemplate = Array.isArray(templates?.data) ? templates.data[0] : null;
    const phoneLinkedToWaba = Array.isArray(phoneNumbers?.data)
      ? phoneNumbers.data.some((item) => String(item?.id || "") === String(phoneNumberId))
      : null;
    return {
      wabaId,
      matchedTemplate,
      phoneLinkedToWaba,
      displayPhoneNumber: phoneInfo?.display_phone_number || "",
      verifiedName: phoneInfo?.verified_name || "",
      templatesError:
        templates?.error?.message ||
        templates?.error?.error_user_msg ||
        templates?.error?.error_data?.details ||
        "",
      phoneNumbersError:
        phoneNumbers?.error?.message ||
        phoneNumbers?.error?.error_user_msg ||
        phoneNumbers?.error?.error_data?.details ||
        "",
    };
  }

  const url = `https://graph.facebook.com/v24.0/${phoneNumberId}/messages`;

  let lastError = "";
  for (const templateName of templateNames) {
    for (const languageCode of languageCodes) {
      const payload = {
        messaging_product: "whatsapp",
        to: digitsOnly(phone),
        type: "template",
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
      };

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
      lastError =
        result?.error?.message ||
        result?.error?.error_data?.details ||
        "Failed to send WhatsApp verification code";
    }
  }

  const diagnostics = await getTemplateDiagnostics(configuredTemplateName).catch(() => null);
  const templateSeen = diagnostics?.matchedTemplate
    ? `${diagnostics.matchedTemplate.name} (${diagnostics.matchedTemplate.language}) [${diagnostics.matchedTemplate.status}]`
    : "not found on connected WABA";
  const connectedWaba = diagnostics?.wabaId || "unknown";
  const connectedNumber =
    diagnostics?.displayPhoneNumber && diagnostics?.verifiedName
      ? `${diagnostics.displayPhoneNumber} (${diagnostics.verifiedName})`
      : "unknown";
  const linkStatus =
    diagnostics?.phoneLinkedToWaba === true
      ? "linked"
      : diagnostics?.phoneLinkedToWaba === false
        ? "not-linked"
        : "unknown";
  const diagnosticsIssue =
    diagnostics?.phoneInfoError || diagnostics?.templatesError || diagnostics?.phoneNumbersError || "";

  return {
    ok: false,
    error: `${lastError}. Check approved template name/language in WhatsApp Manager. Tried names: ${templateNames.join(", ")}; languages: ${languageCodes.join(", ")}. Connected WABA: ${connectedWaba}. Connected number: ${connectedNumber}. Phone-WABA link: ${linkStatus}. Template lookup: ${templateSeen}.${diagnosticsIssue ? ` Graph diagnostics: ${diagnosticsIssue}.` : ""} Ensure WHATSAPP_BUSINESS_ACCOUNT_ID is set and matches the WABA where this phone number and template both exist.`,
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
    if (!historyExists) {
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
