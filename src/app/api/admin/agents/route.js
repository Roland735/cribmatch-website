import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbConnect, User } from "@/lib/db";

export const runtime = "nodejs";

function normalizeAgent(user) {
  const profile = user?.agentProfile || {};
  const rateHistory = Array.isArray(user?.agentRateHistory)
    ? user.agentRateHistory.map((row) => ({
      ...row,
      changedAt: row?.changedAt?.toISOString?.() || row?.changedAt || null,
    }))
    : [];
  const verificationHistory = Array.isArray(user?.agentVerificationHistory)
    ? user.agentVerificationHistory.map((row) => ({
      ...row,
      changedAt: row?.changedAt?.toISOString?.() || row?.changedAt || null,
    }))
    : [];
  return {
    id: user?._id || "",
    name: user?.name || "",
    role: user?.role || "user",
    verificationStatus: profile?.verificationStatus || "none",
    submittedAt: profile?.verificationSubmittedAt?.toISOString?.() || null,
    fullLegalName: profile?.fullLegalName || "",
    contactEmail: profile?.contactEmail || "",
    contactPhone: profile?.contactPhone || "",
    governmentIdNumber: profile?.governmentIdNumber || "",
    governmentIdImageUrl: profile?.governmentIdImageUrl || "",
    agencyLicenseNumber: profile?.agencyLicenseNumber || "",
    agencyAffiliationProof: profile?.agencyAffiliationProof || "",
    agencyName: profile?.agencyName || "",
    profileImageUrl: profile?.profileImageUrl || "",
    commissionRatePercent:
      typeof profile?.commissionRatePercent === "number" ? profile.commissionRatePercent : null,
    fixedFee: typeof profile?.fixedFee === "number" ? profile.fixedFee : null,
    listingsFrozen: Boolean(profile?.listingsFrozen),
    rateHistory,
    verificationHistory,
  };
}

export async function GET(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "admin") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const status = String(url.searchParams.get("status") || "pending").trim();
  const normalizedStatus = ["pending", "all"].includes(status) ? status : "pending";

  await dbConnect();
  const query =
    normalizedStatus === "all"
      ? { role: "agent" }
      : {
        role: "agent",
        "agentProfile.verificationStatus": { $in: ["pending_verification", "pending_reapproval"] },
      };
  const users = await User.find(query).sort({ "agentProfile.verificationSubmittedAt": 1, createdAt: 1 }).lean();
  return Response.json({ agents: users.map(normalizeAgent) });
}
