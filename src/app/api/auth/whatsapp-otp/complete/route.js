import crypto from "crypto";
import Message from "@/lib/Message";
import { dbConnect, Listing, OtpChallenge, Purchase, User } from "@/lib/db";
import { hashPassword, normalizePhoneNumber, normalizePhoneNumberCandidates } from "@/lib/auth";

export const runtime = "nodejs";

const MAX_VERIFY_ATTEMPTS = 6;

function digitsOnly(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

async function verifyCode(code, stored) {
  if (!stored?.codeSalt || !stored?.codeHash) return false;
  const derivedKey = await scryptAsync(String(code || ""), stored.codeSalt);
  const storedHash = Buffer.from(stored.codeHash, "base64");
  if (storedHash.length !== derivedKey.length) return false;
  return crypto.timingSafeEqual(storedHash, derivedKey);
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

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const purpose = String(body?.purpose || "");
  const phoneNumber = normalizePhoneNumber(body?.phoneNumber);
  const code = String(body?.code || "").trim();
  const password = String(body?.password || "");
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  if (!["signup", "reset_password", "first_web_login"].includes(purpose)) {
    return Response.json({ error: "Invalid verification purpose" }, { status: 400 });
  }
  if (!phoneNumber) {
    return Response.json({ error: "Phone number is required" }, { status: 400 });
  }
  if (!code || code.length < 4) {
    return Response.json({ error: "Verification code is required" }, { status: 400 });
  }
  if (typeof password !== "string" || password.length < 8) {
    return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  await dbConnect();
  const challenge = await OtpChallenge.findOne({ phone: phoneNumber, purpose });
  if (!challenge) {
    return Response.json({ error: "No active verification code found" }, { status: 404 });
  }
  if (challenge.usedAt) {
    return Response.json({ error: "Verification code already used" }, { status: 400 });
  }
  if (new Date(challenge.expiresAt).getTime() < Date.now()) {
    return Response.json({ error: "Verification code expired" }, { status: 400 });
  }
  if ((challenge.attempts || 0) >= MAX_VERIFY_ATTEMPTS) {
    return Response.json({ error: "Too many invalid attempts. Request a new code." }, { status: 429 });
  }

  const valid = await verifyCode(code, challenge);
  if (!valid) {
    challenge.attempts = (challenge.attempts || 0) + 1;
    await challenge.save();
    return Response.json({ error: "Invalid verification code" }, { status: 401 });
  }

  const phoneCandidates = normalizePhoneNumberCandidates(phoneNumber);
  const digitsCandidates = toDigitsCandidates(phoneCandidates);
  let user = await User.findOne({ _id: { $in: phoneCandidates } });

  if (purpose === "signup") {
    if (user) {
      return Response.json({ error: "Phone number already registered" }, { status: 409 });
    }
    const passwordRecord = await hashPassword(password);
    user = await User.create({
      _id: phoneNumber,
      name,
      password: passwordRecord,
      role: "user",
      whatsappVerified: true,
      whatsappVerifiedAt: new Date(),
    });
  } else if (purpose === "first_web_login") {
    const historyExists = await hasWhatsappHistory(phoneCandidates, digitsCandidates);
    if (!user && !historyExists) {
      return Response.json({ error: "No previous WhatsApp activity found for this number" }, { status: 404 });
    }
    const passwordRecord = await hashPassword(password);
    if (user) {
      user.password = passwordRecord;
      if (name) user.name = name;
      user.whatsappVerified = true;
      user.whatsappVerifiedAt = new Date();
      await user.save();
    } else {
      user = await User.create({
        _id: phoneNumber,
        name,
        password: passwordRecord,
        role: "user",
        whatsappVerified: true,
        whatsappVerifiedAt: new Date(),
      });
    }
  } else {
    if (!user) {
      return Response.json({ error: "No account found for this phone number" }, { status: 404 });
    }
    const passwordRecord = await hashPassword(password);
    user.password = passwordRecord;
    user.whatsappVerified = true;
    user.whatsappVerifiedAt = new Date();
    await user.save();
  }

  challenge.usedAt = new Date();
  await challenge.save();

  return Response.json({ ok: true, phoneNumber: user._id });
}
