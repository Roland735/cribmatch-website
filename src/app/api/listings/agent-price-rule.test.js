import { beforeEach, describe, expect, test, vi } from "vitest";

const getServerSessionMock = vi.fn();
const dbConnectMock = vi.fn();
const getPricingSettingsMock = vi.fn();
const listingFindMock = vi.fn();
const listingCreateMock = vi.fn();
const userFindByIdMock = vi.fn();

vi.mock("next-auth", () => ({
  getServerSession: (...args) => getServerSessionMock(...args),
}));

vi.mock("@/lib/db", () => ({
  dbConnect: (...args) => dbConnectMock(...args),
  getPricingSettings: (...args) => getPricingSettingsMock(...args),
  Listing: {
    find: (...args) => listingFindMock(...args),
    create: (...args) => listingCreateMock(...args),
  },
  User: {
    findById: (...args) => userFindByIdMock(...args),
  },
}));

import { POST } from "./route";

function makeRequest(body) {
  return new Request("http://localhost/api/listings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const basePayload = {
  title: "Modern Apartment",
  city: "Harare",
  suburb: "Avondale",
  propertyCategory: "residential",
  propertyType: "Apartment",
  pricePerMonth: 800,
  bedrooms: 2,
  deposit: 200,
};

describe("POST /api/listings agent price rule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MONGODB_URI = "mongodb://localhost:27017/test";
    getServerSessionMock.mockResolvedValue({
      user: { phoneNumber: "+263771000001", role: "agent", name: "Agent One" },
    });
    userFindByIdMock.mockReturnValue({
      lean: () =>
        Promise.resolve({
          role: "agent",
          agentProfile: {
            verificationStatus: "verified",
            listingsFrozen: false,
            commissionRatePercent: 10,
            fixedFee: 20,
          },
        }),
    });
    getPricingSettingsMock.mockResolvedValue({
      agentPriceDiscountPercent: 10,
    });
    listingFindMock.mockReturnValue({
      select: () => ({
        limit: () => ({
          lean: () =>
            Promise.resolve([
              { city: "Harare", suburb: "Avondale", pricePerMonth: 1000 },
              { city: "Harare", suburb: "Avondale", pricePerMonth: 900 },
              { city: "Harare", suburb: "Avondale", pricePerMonth: 1100 },
            ]),
        }),
      }),
    });
  });

  test("rejects agent listing when above allowed discounted median", async () => {
    const response = await POST(
      makeRequest({
        ...basePayload,
        pricePerMonth: 950,
      }),
    );
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toMatch(/Agent listing must be at least/);
  });

  test("creates agent listing with lister_type and agent_rate when valid", async () => {
    listingCreateMock.mockResolvedValue({
      _id: "listing-1",
      ...basePayload,
      listerType: "agent",
      agentRate: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
      toObject() {
        return this;
      },
    });

    const response = await POST(
      makeRequest({
        ...basePayload,
        pricePerMonth: 850,
      }),
    );

    expect(response.status).toBe(201);
    expect(listingCreateMock).toHaveBeenCalledTimes(1);
    const createInput = listingCreateMock.mock.calls[0][0];
    expect(createInput.listerType).toBe("agent");
    expect(createInput.agentRate).toBe(10);
    expect(createInput.approved).toBe(false);

    const payload = await response.json();
    expect(payload.listing.lister_type).toBe("agent");
    expect(payload.listing.agent_rate).toBe(10);
  });

  test("allows verified agent to create landlord listing when explicitly selected", async () => {
    listingCreateMock.mockResolvedValue({
      _id: "listing-2",
      ...basePayload,
      listerType: "direct_landlord",
      agentRate: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      toObject() {
        return this;
      },
    });

    const response = await POST(
      makeRequest({
        ...basePayload,
        listerType: "direct_landlord",
        pricePerMonth: 1300,
      }),
    );

    expect(response.status).toBe(201);
    const createInput = listingCreateMock.mock.calls[0][0];
    expect(createInput.listerType).toBe("direct_landlord");
    expect(createInput.agentRate).toBe(null);
    const payload = await response.json();
    expect(payload.listing.lister_type).toBe("direct_landlord");
  });

  test("uses broader benchmark when micro-market has no direct-landlord listings", async () => {
    listingFindMock.mockReturnValue({
      select: () => ({
        limit: () => ({
          lean: () =>
            Promise.resolve([
              { city: "Bulawayo", suburb: "Matsheumhlope", pricePerMonth: 900 },
              { city: "Bulawayo", suburb: "North End", pricePerMonth: 1000 },
              { city: "Mutare", suburb: "Murambi", pricePerMonth: 800 },
            ]),
        }),
      }),
    });

    listingCreateMock.mockResolvedValue({
      _id: "listing-3",
      ...basePayload,
      listerType: "agent",
      agentRate: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
      toObject() {
        return this;
      },
    });

    const response = await POST(
      makeRequest({
        ...basePayload,
        listerType: "agent",
        city: "Harare",
        suburb: "Greendale",
        pricePerMonth: 700,
      }),
    );

    expect(response.status).toBe(201);
    expect(listingCreateMock).toHaveBeenCalledTimes(1);
    const payload = await response.json();
    expect(payload.listing.lister_type).toBe("agent");
  });

  test("allows agent listing when no benchmark data exists anywhere", async () => {
    listingFindMock.mockReturnValue({
      select: () => ({
        limit: () => ({
          lean: () => Promise.resolve([]),
        }),
      }),
    });

    listingCreateMock.mockResolvedValue({
      _id: "listing-4",
      ...basePayload,
      listerType: "agent",
      agentRate: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
      toObject() {
        return this;
      },
    });

    const response = await POST(
      makeRequest({
        ...basePayload,
        listerType: "agent",
        city: "Gweru",
        suburb: "Daylesford",
        pricePerMonth: 2500,
      }),
    );

    expect(response.status).toBe(201);
    expect(listingCreateMock).toHaveBeenCalledTimes(1);
    const payload = await response.json();
    expect(payload.listing.lister_type).toBe("agent");
  });
});
