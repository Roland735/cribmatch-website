import { beforeEach, describe, expect, test, vi } from "vitest";

const getServerSessionMock = vi.fn();
const dbConnectMock = vi.fn();
const findByIdMock = vi.fn();

vi.mock("next-auth", () => ({
  getServerSession: (...args) => getServerSessionMock(...args),
}));

vi.mock("@/lib/db", () => ({
  dbConnect: (...args) => dbConnectMock(...args),
  User: {
    findById: (...args) => findByIdMock(...args),
  },
}));

import { PATCH } from "./[id]/status/route";

function makeRequest(body) {
  return new Request("http://localhost/api/admin/agents/agent-1/status", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeParams() {
  return { params: Promise.resolve({ id: "agent-1" }) };
}

describe("PATCH /api/admin/agents/[id]/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSessionMock.mockResolvedValue({
      user: { role: "admin", phoneNumber: "+263770000001", name: "Admin" },
    });
  });

  test("rejects verify when required profile details are missing", async () => {
    findByIdMock.mockResolvedValue({
      _id: "agent-1",
      role: "agent",
      agentProfile: {
        verificationStatus: "pending_verification",
        fullLegalName: "Agent One",
        contactEmail: "agent@example.com",
        contactPhone: "+263771000001",
        governmentIdNumber: "",
        agencyLicenseNumber: "",
        agencyAffiliationProof: "",
        agencyName: "",
        commissionRatePercent: 7,
      },
      agentVerificationHistory: [],
      save: vi.fn(),
    });

    const response = await PATCH(
      makeRequest({ status: "verified", reason: "Looks good" }),
      makeParams(),
    );
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toMatch(/Agent profile is incomplete/);
  });

  test("allows admin rejection with reason", async () => {
    const saveMock = vi.fn().mockResolvedValue(undefined);
    findByIdMock.mockResolvedValue({
      _id: "agent-1",
      role: "agent",
      agentProfile: {
        verificationStatus: "pending_verification",
      },
      agentVerificationHistory: [],
      save: saveMock,
    });

    const response = await PATCH(
      makeRequest({ status: "rejected", reason: "Invalid agency documents" }),
      makeParams(),
    );
    expect(response.status).toBe(200);
    expect(saveMock).toHaveBeenCalledTimes(1);
    const payload = await response.json();
    expect(payload.agent.verificationStatus).toBe("rejected");
  });
});
