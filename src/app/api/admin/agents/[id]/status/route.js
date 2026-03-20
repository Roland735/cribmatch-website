import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbConnect, User } from "@/lib/db";

export const runtime = "nodejs";

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export async function PATCH(request, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "admin") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return Response.json({ error: "Agent id is required" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const nextStatusRaw = cleanText(body?.status);
  const reason = cleanText(body?.reason);
  const allowedStatuses = new Set(["verified", "rejected", "pending_reapproval"]);
  if (!allowedStatuses.has(nextStatusRaw)) {
    return Response.json({ error: "Invalid status" }, { status: 400 });
  }
  if (!reason) {
    return Response.json({ error: "Status change reason is required" }, { status: 400 });
  }

  await dbConnect();
  const user = await User.findById(id);
  if (!user || user.role !== "agent") {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }

  const now = new Date();
  const previousStatus = user?.agentProfile?.verificationStatus || "none";
  const nextStatus = nextStatusRaw;
  const profile = user?.agentProfile || {};
  if (nextStatus === "verified") {
    const hasRequiredIdentity =
      cleanText(profile?.fullLegalName) &&
      cleanText(profile?.contactEmail) &&
      cleanText(profile?.contactPhone) &&
      cleanText(profile?.governmentIdNumber) &&
      cleanText(profile?.governmentIdImageUrl) &&
      cleanText(profile?.agencyName);
    const hasAnyFee =
      typeof profile?.commissionRatePercent === "number" ||
      typeof profile?.fixedFee === "number";
    if (!hasRequiredIdentity || !hasAnyFee) {
      return Response.json(
        {
          error:
            "Agent profile is incomplete. Gov ID number, Gov ID image, agency name, contact details, and at least one fee are required.",
        },
        { status: 400 },
      );
    }
  }
  const listingsFrozen = nextStatus !== "verified";

  user.agentProfile = {
    ...(user.agentProfile?.toObject?.() || user.agentProfile || {}),
    verificationStatus: nextStatus,
    listingsFrozen,
    verifiedAt: nextStatus === "verified" ? now : user?.agentProfile?.verifiedAt || null,
    rejectedAt: nextStatus === "rejected" ? now : user?.agentProfile?.rejectedAt || null,
  };
  user.agentVerificationHistory = [
    ...(Array.isArray(user.agentVerificationHistory) ? user.agentVerificationHistory : []),
    {
      fromStatus: previousStatus,
      toStatus: nextStatus,
      adminId: session.user.phoneNumber || session.user.name || "admin",
      reason,
      changedAt: now,
    },
  ];
  await user.save();

  return Response.json({
    ok: true,
    agent: {
      id: user._id,
      verificationStatus: user?.agentProfile?.verificationStatus || nextStatus,
      listingsFrozen: Boolean(user?.agentProfile?.listingsFrozen),
    },
    audit: {
      adminId: session.user.phoneNumber || session.user.name || "admin",
      changedAt: now.toISOString(),
      reason,
      fromStatus: previousStatus,
      toStatus: nextStatus,
    },
  });
}
