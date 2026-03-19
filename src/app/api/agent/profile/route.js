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

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
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
  const commissionRatePercent = asRate(body?.commissionRatePercent);
  const fixedFee = asMoney(body?.fixedFee);
  const note = cleanText(body?.note);

  if (commissionRatePercent === null || fixedFee === null) {
    return Response.json({ error: "Valid commission rate and fixed fee are required" }, { status: 400 });
  }

  const currentRate = Number(user?.agentProfile?.commissionRatePercent);
  const currentFee = Number(user?.agentProfile?.fixedFee);
  const changed = currentRate !== commissionRatePercent || currentFee !== fixedFee;
  if (!changed) {
    return Response.json({ ok: true, unchanged: true });
  }

  const previousStatus = user?.agentProfile?.verificationStatus || "none";
  const now = new Date();
  user.agentProfile = {
    ...(user.agentProfile?.toObject?.() || user.agentProfile || {}),
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
      reason: "Rate updated by agent",
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
