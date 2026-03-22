import { beforeEach, describe, expect, test, vi } from "vitest";

const getServerSessionMock = vi.fn();
const dbConnectMock = vi.fn();
const cityFindOneMock = vi.fn();
const suburbFindOneMock = vi.fn();
const suburbCreateMock = vi.fn();
const bumpLocationsVersionMock = vi.fn();
const invalidateLocationsCacheMock = vi.fn();

vi.mock("next-auth", () => ({
  getServerSession: (...args) => getServerSessionMock(...args),
}));

vi.mock("@/lib/db", () => ({
  dbConnect: (...args) => dbConnectMock(...args),
  LocationCity: {
    findOne: (...args) => cityFindOneMock(...args),
  },
  LocationSuburb: {
    findOne: (...args) => suburbFindOneMock(...args),
    create: (...args) => suburbCreateMock(...args),
  },
}));

vi.mock("@/lib/locations", () => ({
  getLocationsSnapshot: vi.fn(),
  bumpLocationsVersion: (...args) => bumpLocationsVersionMock(...args),
  invalidateLocationsCache: (...args) => invalidateLocationsCacheMock(...args),
}));

import { POST } from "./route";

describe("POST /api/admin/locations/suburbs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("rejects missing city", async () => {
    getServerSessionMock.mockResolvedValue({ user: { role: "admin" } });
    const response = await POST(
      new Request("http://localhost/api/admin/locations/suburbs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ suburb_name: "Borrowdale" }),
      }),
    );
    expect(response.status).toBe(400);
  });

  test("creates suburb when city exists", async () => {
    getServerSessionMock.mockResolvedValue({ user: { role: "admin" } });
    cityFindOneMock.mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve({ _id: "1", cityName: "Harare" }) }),
    });
    suburbFindOneMock
      .mockReturnValueOnce({ lean: () => ({ exec: () => Promise.resolve(null) }) })
      .mockReturnValueOnce({ lean: () => ({ exec: () => Promise.resolve(null) }) });
    suburbCreateMock.mockResolvedValue({
      suburbId: "borrowdale_harare",
      suburbName: "Borrowdale",
      cityId: "harare",
    });

    const response = await POST(
      new Request("http://localhost/api/admin/locations/suburbs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ city_id: "harare", suburb_name: "Borrowdale" }),
      }),
    );
    expect(response.status).toBe(201);
    expect(suburbCreateMock).toHaveBeenCalledTimes(1);
    expect(bumpLocationsVersionMock).toHaveBeenCalledTimes(1);
    expect(invalidateLocationsCacheMock).toHaveBeenCalledTimes(1);
  });
});
