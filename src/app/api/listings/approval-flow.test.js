import { beforeEach, describe, expect, test, vi } from "vitest";

const getServerSessionMock = vi.fn();
const dbConnectMock = vi.fn();
const findByIdMock = vi.fn();
const findByIdAndUpdateMock = vi.fn();
const findMock = vi.fn();
const getPricingSettingsMock = vi.fn();

vi.mock("next-auth", () => ({
  getServerSession: (...args) => getServerSessionMock(...args),
}));

vi.mock("@/lib/db", () => ({
  dbConnect: (...args) => dbConnectMock(...args),
  getPricingSettings: (...args) => getPricingSettingsMock(...args),
  Listing: {
    findById: (...args) => findByIdMock(...args),
    findByIdAndUpdate: (...args) => findByIdAndUpdateMock(...args),
    find: (...args) => findMock(...args),
  },
}));

vi.mock("@/lib/seedListings.json", () => ({ default: [] }));

import { PATCH } from "./[id]/route";

function makePatchRequest(body) {
  return new Request("http://localhost/api/listings/abc123", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params() {
  return { params: Promise.resolve({ id: "abc123" }) };
}

describe("PATCH /api/listings/[id] approval flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MONGODB_URI = "mongodb://localhost:27017/test";
    getPricingSettingsMock.mockResolvedValue({ agentPriceDiscountPercent: 5 });
    findMock.mockReturnValue({
      select: () => ({
        limit: () => ({
          lean: () =>
            Promise.resolve([
              { city: "Harare", suburb: "Avondale", pricePerMonth: 900 },
              { city: "Harare", suburb: "Avondale", pricePerMonth: 1000 },
            ]),
        }),
      }),
    });
    findByIdMock.mockResolvedValue({
      _id: "abc123",
      listerPhoneNumber: "+263771000001",
      propertyCategory: "residential",
      propertyType: "Apartment",
      title: "Listing",
      city: "Harare",
      suburb: "Avondale",
      pricePerMonth: 800,
      deposit: 100,
      bedrooms: 2,
      listerType: "agent",
    });
    findByIdAndUpdateMock.mockResolvedValue({
      _id: "abc123",
      title: "Listing",
      city: "Harare",
      suburb: "Avondale",
      propertyCategory: "residential",
      propertyType: "Apartment",
      pricePerMonth: 800,
      deposit: 100,
      bedrooms: 2,
      approved: true,
      listerType: "agent",
      agentRate: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
      toObject() {
        return this;
      },
    });
  });

  test("blocks non-admin listing approval changes", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { phoneNumber: "+263771000001", role: "agent" },
    });

    const response = await PATCH(makePatchRequest({ approved: true }), params());
    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.error).toMatch(/Only admins can approve or reject listings/);
  });

  test("stores admin metadata and reason when approving", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { phoneNumber: "+263770000001", role: "admin" },
    });

    const response = await PATCH(
      makePatchRequest({ approved: true, approvalReason: "Compliance checks passed" }),
      params(),
    );
    expect(response.status).toBe(200);
    expect(findByIdAndUpdateMock).toHaveBeenCalledTimes(1);
    const updatePayload = findByIdAndUpdateMock.mock.calls[0][1];
    expect(updatePayload.approved).toBe(true);
    expect(updatePayload.approvedByAdminId).toBe("+263770000001");
    expect(updatePayload.approvalReason).toBe("Compliance checks passed");
    expect(updatePayload.approvalStatus).toBe("approved");
    expect(updatePayload.$push.approvalHistory.status).toBe("approved");
  });
});
