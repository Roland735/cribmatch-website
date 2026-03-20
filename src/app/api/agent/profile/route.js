import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbConnect, User } from "@/lib/db";

export const runtime = "nodejs";

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

function asOptionalRate(value) {
  if (value === null || value === undefined || value === "") return null;
  return asRate(value);
}

function asOptionalMoney(value) {
  if (value === null || value === undefined || value === "") return null;
  return asMoney(value);
}

function asOptionalWholeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.floor(num);
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanStringArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => cleanText(item))
      .filter(Boolean)
      .slice(0, 12);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 12);
  }
  return [];
}

function serializeAuditRows(rows = []) {
  return rows.map((row) => ({
    ...row,
    changedAt: row?.changedAt?.toISOString?.() || row?.changedAt || null,
  }));
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const phoneNumber =
    typeof session?.user?.phoneNumber === "string" ? session.user.phoneNumber.trim() : "";
  if (!phoneNumber) {
    return Response.json({ error: "Missing phone number" }, { status: 400 });
  }

  await dbConnect();
  const user = await User.findById(phoneNumber).lean();
  if (!user || user.role !== "agent") {
    return Response.json({ error: "Agent profile not found" }, { status: 404 });
  }

  return Response.json({
    profile: {
      ...(user.agentProfile || {}),
      verificationSubmittedAt: user?.agentProfile?.verificationSubmittedAt?.toISOString?.() || null,
      verifiedAt: user?.agentProfile?.verifiedAt?.toISOString?.() || null,
      rejectedAt: user?.agentProfile?.rejectedAt?.toISOString?.() || null,
    },
    rateHistory: serializeAuditRows(user.agentRateHistory || []),
    verificationHistory: serializeAuditRows(user.agentVerificationHistory || []),
  });
}

export async function PATCH(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const phoneNumber =
    typeof session?.user?.phoneNumber === "string" ? session.user.phoneNumber.trim() : "";
  if (!phoneNumber) {
    return Response.json({ error: "Missing phone number" }, { status: 400 });
  }

  await dbConnect();
  const user = await User.findById(phoneNumber);
  if (!user || user.role !== "agent") {
    return Response.json({ error: "Agent profile not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const commissionRatePercent = asOptionalRate(body?.commissionRatePercent);
  const fixedFee = asOptionalMoney(body?.fixedFee);
  const note = cleanText(body?.note);
  const feePreferenceRaw = cleanText(body?.feePreference).toLowerCase();
  const feePreference = ["commission", "fixed", "both"].includes(feePreferenceRaw)
    ? feePreferenceRaw
    : "both";
  const fullLegalName = cleanText(body?.fullLegalName);
  const contactEmail = cleanText(body?.contactEmail);
  const contactPhone = cleanText(body?.contactPhone);
  const governmentIdNumber = cleanText(body?.governmentIdNumber);
  const agencyLicenseNumber = cleanText(body?.agencyLicenseNumber);
  const agencyAffiliationProof = cleanText(body?.agencyAffiliationProof);
  const agencyName = cleanText(body?.agencyName);
  const alternatePhone = cleanText(body?.alternatePhone);
  const officeAddress = cleanText(body?.officeAddress);
  const city = cleanText(body?.city);
  const yearsExperience = asOptionalWholeNumber(body?.yearsExperience);
  const areasServed = cleanStringArray(body?.areasServed);
  const specializations = cleanStringArray(body?.specializations);
  const bio = cleanText(body?.bio);
  const preferredContactMethod = cleanText(body?.preferredContactMethod);
  const websiteUrl = cleanText(body?.websiteUrl);

  if (commissionRatePercent === null && fixedFee === null) {
    return Response.json(
      { error: "Provide either a valid commission rate or fixed fee" },
      { status: 400 },
    );
  }
  if (!fullLegalName || !contactEmail || !contactPhone) {
    return Response.json(
      { error: "Full legal name, contact email, and contact phone are required" },
      { status: 400 },
    );
  }
  if (!governmentIdNumber || !agencyLicenseNumber || !agencyAffiliationProof || !agencyName) {
    return Response.json(
      { error: "Gov ID, license, agency name, and affiliation proof are required" },
      { status: 400 },
    );
  }

  const currentProfile = user?.agentProfile || {};
  const changed =
    Number(currentProfile?.commissionRatePercent) !== commissionRatePercent ||
    Number(currentProfile?.fixedFee) !== fixedFee ||
    cleanText(currentProfile?.feePreference).toLowerCase() !== feePreference ||
    cleanText(currentProfile?.fullLegalName) !== fullLegalName ||
    cleanText(currentProfile?.contactEmail) !== contactEmail ||
    cleanText(currentProfile?.contactPhone) !== contactPhone ||
    cleanText(currentProfile?.governmentIdNumber) !== governmentIdNumber ||
    cleanText(currentProfile?.agencyLicenseNumber) !== agencyLicenseNumber ||
    cleanText(currentProfile?.agencyAffiliationProof) !== agencyAffiliationProof ||
    cleanText(currentProfile?.agencyName) !== agencyName ||
    cleanText(currentProfile?.alternatePhone) !== alternatePhone ||
    cleanText(currentProfile?.officeAddress) !== officeAddress ||
    cleanText(currentProfile?.city) !== city ||
    Number(currentProfile?.yearsExperience) !== yearsExperience ||
    JSON.stringify(currentProfile?.areasServed || []) !== JSON.stringify(areasServed) ||
    JSON.stringify(currentProfile?.specializations || []) !== JSON.stringify(specializations) ||
    cleanText(currentProfile?.bio) !== bio ||
    cleanText(currentProfile?.preferredContactMethod) !== preferredContactMethod ||
    cleanText(currentProfile?.websiteUrl) !== websiteUrl;
  if (!changed) {
    return Response.json({ ok: true, unchanged: true });
  }

  const previousStatus = user?.agentProfile?.verificationStatus || "none";
  const now = new Date();
  user.agentProfile = {
    ...(user.agentProfile?.toObject?.() || user.agentProfile || {}),
    fullLegalName,
    contactEmail,
    contactPhone,
    governmentIdNumber,
    agencyLicenseNumber,
    agencyAffiliationProof,
    agencyName,
    alternatePhone,
    officeAddress,
    city,
    yearsExperience,
    areasServed,
    specializations,
    bio,
    preferredContactMethod,
    websiteUrl,
    feePreference,
    commissionRatePercent,
    fixedFee,
    verificationStatus: "pending_reapproval",
    verificationSubmittedAt: now,
    listingsFrozen: true,
  };
  user.agentRateHistory = [
    ...(Array.isArray(user.agentRateHistory) ? user.agentRateHistory : []),
    {
      commissionRatePercent,
      fixedFee,
      feePreference,
      changedBy: phoneNumber,
      changedAt: now,
      note: note || "Agent updated rates",
    },
  ];
  user.agentVerificationHistory = [
    ...(Array.isArray(user.agentVerificationHistory) ? user.agentVerificationHistory : []),
    {
      fromStatus: previousStatus,
      toStatus: "pending_reapproval",
      adminId: "",
      reason: "Profile updated by agent",
      changedAt: now,
    },
  ];
  await user.save();

  return Response.json({
    ok: true,
    profile: {
      ...(user.agentProfile?.toObject?.() || user.agentProfile || {}),
      verificationSubmittedAt: user?.agentProfile?.verificationSubmittedAt?.toISOString?.() || null,
    },
    rateHistory: serializeAuditRows(user.agentRateHistory || []),
    verificationHistory: serializeAuditRows(user.agentVerificationHistory || []),
  });
}
