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

import { POST } from "./route";

function makeRequest(body) {
  return new Request("http://localhost/api/agents/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/agents/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSessionMock.mockResolvedValue({
      user: { phoneNumber: "+263771000001", role: "user" },
    });
  });

  test("rejects missing mandatory registration fields", async () => {
    const response = await POST(
      makeRequest({
        fullLegalName: "Agent One",
        contactEmail: "",
        contactPhone: "+263771000001",
        governmentIdNumber: "",
        agencyLicenseNumber: "LIC-100",
        agencyAffiliationProof: "",
        commissionRatePercent: 7,
        fixedFee: 50,
      }),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toMatch(/Missing required agent registration fields/);
  });

  test("rejects when rates are not valid", async () => {
    const response = await POST(
      makeRequest({
        fullLegalName: "Agent One",
        contactEmail: "agent@example.com",
        contactPhone: "+263771000001",
        governmentIdNumber: "ID123456",
        agencyLicenseNumber: "LIC-100",
        agencyAffiliationProof: "https://example.com/proof.pdf",
        commissionRatePercent: -1,
        fixedFee: -2,
      }),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toMatch(/Commission rate and fixed fee are required/);
  });

  test("creates pending verification agent application", async () => {
    const saveMock = vi.fn().mockResolvedValue(undefined);
    findByIdMock.mockResolvedValue({
      _id: "+263771000001",
      role: "user",
      agentProfile: { verificationStatus: "none" },
      agentVerificationHistory: [],
      agentRateHistory: [],
      save: saveMock,
    });

    const response = await POST(
      makeRequest({
        fullLegalName: "Agent One",
        contactEmail: "agent@example.com",
        contactPhone: "+263771000001",
        governmentIdNumber: "ID123456",
        agencyLicenseNumber: "LIC-100",
        agencyAffiliationProof: "https://example.com/proof.pdf",
        agencyName: "Prime Realty",
        commissionRatePercent: 7.5,
        fixedFee: 50,
      }),
    );

    expect(response.status).toBe(200);
    expect(saveMock).toHaveBeenCalledTimes(1);
    const payload = await response.json();
    expect(payload.application.verificationStatus).toBe("pending_verification");
    expect(payload.application.commissionRatePercent).toBe(7.5);
    expect(payload.application.fixedFee).toBe(50);
  });
});
