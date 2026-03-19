import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbConnect, Listing, User } from "@/lib/db";
import { searchListings } from "@/lib/getListings";

export const runtime = "nodejs";

function toSafeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function serializeAgent(user) {
  const profile = user?.agentProfile || {};
  return {
    id: user?._id || "",
    verificationStatus: profile?.verificationStatus || "none",
    fullLegalName: profile?.fullLegalName || "",
    contactEmail: profile?.contactEmail || "",
    contactPhone: profile?.contactPhone || "",
    commissionRatePercent:
      typeof profile?.commissionRatePercent === "number" ? profile.commissionRatePercent : null,
    fixedFee: typeof profile?.fixedFee === "number" ? profile.fixedFee : null,
  };
}

function serializeListing(listing) {
  return {
    ...listing,
    _id: listing?._id?.toString?.() ?? listing?._id,
    lister_type: listing?.listerType || listing?.lister_type || "direct_landlord",
    agent_rate:
      typeof listing?.agentRate === "number"
        ? listing.agentRate
        : typeof listing?.agent_rate === "number"
          ? listing.agent_rate
          : null,
  };
}

async function handleAgentApplications(session, variables = {}) {
  if (!session?.user || session.user.role !== "admin") {
    throw new Error("Unauthorized");
  }
  await dbConnect();
  const status = toSafeString(variables?.status || "pending");
  const query =
    status === "all"
      ? { role: "agent" }
      : {
        role: "agent",
        "agentProfile.verificationStatus": { $in: ["pending_verification", "pending_reapproval"] },
      };
  const users = await User.find(query).lean();
  return { agentApplications: users.map(serializeAgent) };
}

async function handleListings(variables = {}) {
  const result = await searchListings({
    status: "published",
    approvedOnly: true,
    q: toSafeString(variables?.q),
    city: toSafeString(variables?.city),
    suburb: toSafeString(variables?.suburb),
    propertyCategory: toSafeString(variables?.propertyCategory),
    propertyType: toSafeString(variables?.propertyType),
    minPrice: variables?.minPrice ?? null,
    maxPrice: variables?.maxPrice ?? null,
    perPage: variables?.perPage ?? 24,
    page: variables?.page ?? 1,
  });
  return {
    listings: Array.isArray(result?.listings) ? result.listings.map(serializeListing) : [],
    total: Number(result?.total || 0),
  };
}

async function handleUpdateAgentStatus(session, variables = {}) {
  if (!session?.user || session.user.role !== "admin") {
    throw new Error("Unauthorized");
  }
  const id = toSafeString(variables?.id);
  const status = toSafeString(variables?.status);
  const reason = toSafeString(variables?.reason);
  if (!id || !status || !reason) {
    throw new Error("id, status, and reason are required");
  }
  if (!["verified", "rejected", "pending_reapproval"].includes(status)) {
    throw new Error("Invalid status");
  }

  await dbConnect();
  const user = await User.findById(id);
  if (!user || user.role !== "agent") {
    throw new Error("Agent not found");
  }
  const now = new Date();
  const previousStatus = user?.agentProfile?.verificationStatus || "none";
  user.agentProfile = {
    ...(user.agentProfile?.toObject?.() || user.agentProfile || {}),
    verificationStatus: status,
    listingsFrozen: status !== "verified",
    verifiedAt: status === "verified" ? now : user?.agentProfile?.verifiedAt || null,
    rejectedAt: status === "rejected" ? now : user?.agentProfile?.rejectedAt || null,
  };
  user.agentVerificationHistory = [
    ...(Array.isArray(user.agentVerificationHistory) ? user.agentVerificationHistory : []),
    {
      fromStatus: previousStatus,
      toStatus: status,
      adminId: session.user.phoneNumber || session.user.name || "admin",
      reason,
      changedAt: now,
    },
  ];
  await user.save();
  return { updateAgentStatus: serializeAgent(user.toObject()) };
}

async function handleRegisterAgent(session, variables = {}) {
  if (!session?.user) {
    throw new Error("Unauthorized");
  }
  const phoneNumber = toSafeString(session?.user?.phoneNumber);
  if (!phoneNumber) throw new Error("Missing phone number");

  await dbConnect();
  const user = await User.findById(phoneNumber);
  if (!user) throw new Error("User not found");

  const fullLegalName = toSafeString(variables?.fullLegalName);
  const contactEmail = toSafeString(variables?.contactEmail);
  const contactPhone = toSafeString(variables?.contactPhone);
  const governmentIdNumber = toSafeString(variables?.governmentIdNumber);
  const agencyLicenseNumber = toSafeString(variables?.agencyLicenseNumber);
  const agencyAffiliationProof = toSafeString(variables?.agencyAffiliationProof);
  const commissionRatePercent = Number(variables?.commissionRatePercent);
  const fixedFee = Number(variables?.fixedFee);
  if (
    !fullLegalName ||
    !contactEmail ||
    !contactPhone ||
    !governmentIdNumber ||
    !agencyLicenseNumber ||
    !agencyAffiliationProof ||
    !Number.isFinite(commissionRatePercent) ||
    commissionRatePercent < 0 ||
    commissionRatePercent > 100 ||
    !Number.isFinite(fixedFee) ||
    fixedFee < 0
  ) {
    throw new Error("Missing required fields");
  }

  const now = new Date();
  const previousStatus = user?.agentProfile?.verificationStatus || "none";
  user.role = "agent";
  user.agentProfile = {
    ...(user.agentProfile?.toObject?.() || user.agentProfile || {}),
    fullLegalName,
    contactEmail,
    contactPhone,
    governmentIdNumber,
    agencyLicenseNumber,
    agencyAffiliationProof,
    commissionRatePercent,
    fixedFee,
    verificationStatus: "pending_verification",
    verificationSubmittedAt: now,
    listingsFrozen: true,
  };
  user.agentVerificationHistory = [
    ...(Array.isArray(user.agentVerificationHistory) ? user.agentVerificationHistory : []),
    {
      fromStatus: previousStatus,
      toStatus: "pending_verification",
      adminId: "",
      reason: "Submitted for verification",
      changedAt: now,
    },
  ];
  user.agentRateHistory = [
    ...(Array.isArray(user.agentRateHistory) ? user.agentRateHistory : []),
    {
      commissionRatePercent,
      fixedFee,
      changedBy: phoneNumber,
      changedAt: now,
      note: "Initial registration",
    },
  ];
  await user.save();
  return { registerAgent: serializeAgent(user.toObject()) };
}

export async function POST(request) {
  const session = await getServerSession(authOptions);
  const body = await request.json().catch(() => ({}));
  const operationName = toSafeString(body?.operationName);
  const variables = body?.variables && typeof body.variables === "object" ? body.variables : {};

  try {
    if (operationName === "AgentApplications") {
      return Response.json({ data: await handleAgentApplications(session, variables) });
    }
    if (operationName === "ListingsSearch") {
      return Response.json({ data: await handleListings(variables) });
    }
    if (operationName === "UpdateAgentStatus") {
      return Response.json({ data: await handleUpdateAgentStatus(session, variables) });
    }
    if (operationName === "RegisterAgent") {
      return Response.json({ data: await handleRegisterAgent(session, variables) });
    }
    return Response.json({ errors: [{ message: "Unsupported operationName" }] }, { status: 400 });
  } catch (error) {
    return Response.json(
      { errors: [{ message: error?.message || "GraphQL execution failed" }] },
      { status: error?.message === "Unauthorized" ? 401 : 400 },
    );
  }
}
