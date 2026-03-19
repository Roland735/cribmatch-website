import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbConnect, User } from "@/lib/db";

export const runtime = "nodejs";

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asRate(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || num > 100) return null;
  return Math.round(num * 100) / 100;
}

function asMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100) / 100;
}

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const phoneNumber =
    typeof session?.user?.phoneNumber === "string" ? session.user.phoneNumber.trim() : "";
  if (!phoneNumber) {
    return Response.json({ error: "Missing phone number" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const fullLegalName = cleanText(body?.fullLegalName);
  const contactEmail = cleanText(body?.contactEmail);
  const contactPhone = cleanText(body?.contactPhone);
  const governmentIdNumber = cleanText(body?.governmentIdNumber);
  const agencyLicenseNumber = cleanText(body?.agencyLicenseNumber);
  const agencyAffiliationProof = cleanText(body?.agencyAffiliationProof);
  const agencyName = cleanText(body?.agencyName);
  const commissionRatePercent = asRate(body?.commissionRatePercent);
  const fixedFee = asMoney(body?.fixedFee);

  if (
    !fullLegalName ||
    !contactEmail ||
    !contactPhone ||
    !governmentIdNumber ||
    !agencyLicenseNumber ||
    !agencyAffiliationProof
  ) {
    return Response.json({ error: "Missing required agent registration fields" }, { status: 400 });
  }
  if (commissionRatePercent === null || fixedFee === null) {
    return Response.json({ error: "Commission rate and fixed fee are required" }, { status: 400 });
  }

  await dbConnect();
  const existingUser = await User.findById(phoneNumber);
  if (!existingUser) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  const previousStatus = existingUser?.agentProfile?.verificationStatus || "none";
  const now = new Date();

  existingUser.role = "agent";
  existingUser.agentProfile = {
    ...(existingUser.agentProfile?.toObject?.() || existingUser.agentProfile || {}),
    fullLegalName,
    contactEmail,
    contactPhone,
    governmentIdNumber,
    agencyLicenseNumber,
    agencyAffiliationProof,
    agencyName,
    commissionRatePercent,
    fixedFee,
    verificationStatus: "pending_verification",
    verificationSubmittedAt: now,
    listingsFrozen: true,
  };
  existingUser.agentVerificationHistory = [
    ...(Array.isArray(existingUser.agentVerificationHistory) ? existingUser.agentVerificationHistory : []),
    {
      fromStatus: previousStatus,
      toStatus: "pending_verification",
      adminId: "",
      reason: "Submitted for verification",
      changedAt: now,
    },
  ];
  existingUser.agentRateHistory = [
    ...(Array.isArray(existingUser.agentRateHistory) ? existingUser.agentRateHistory : []),
    {
      commissionRatePercent,
      fixedFee,
      changedBy: phoneNumber,
      changedAt: now,
      note: "Initial registration",
    },
  ];
  await existingUser.save();

  return Response.json({
    ok: true,
    application: {
      verificationStatus: "pending_verification",
      verificationSubmittedAt: now.toISOString(),
      commissionRatePercent,
      fixedFee,
    },
  });
}
