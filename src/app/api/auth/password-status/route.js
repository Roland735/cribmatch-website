import Message from "@/lib/Message";
import { dbConnect, Listing, Purchase, User } from "@/lib/db";
import { normalizePhoneNumber, normalizePhoneNumberCandidates } from "@/lib/auth";

export const runtime = "nodejs";

function digitsOnly(value) {
  return String(value || "").replace(/[^\d]/g, "");
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
  const phoneNumber = normalizePhoneNumber(body?.phoneNumber);
  if (!phoneNumber) {
    return Response.json({ error: "Phone number is required" }, { status: 400 });
  }

  await dbConnect();
  const phoneCandidates = normalizePhoneNumberCandidates(phoneNumber);
  const digitsCandidates = toDigitsCandidates(phoneCandidates);
  const user = await User.findOne({ _id: { $in: phoneCandidates } }).lean();
  const hasPassword = Boolean(user?.password?.salt && user?.password?.hash);
  const historyExists = await hasWhatsappHistory(phoneCandidates, digitsCandidates);
  const requiresPasswordSetup = Boolean((user && !hasPassword) || (!user && historyExists));

  return Response.json({
    ok: true,
    accountExists: Boolean(user),
    hasPassword,
    historyExists,
    requiresPasswordSetup,
  });
}
