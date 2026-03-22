import { beforeEach, describe, expect, test, vi } from "vitest";

const getServerSessionMock = vi.fn();
const dbConnectMock = vi.fn();
const findOneMock = vi.fn();
const findMock = vi.fn();
const createMock = vi.fn();
const bumpLocationsVersionMock = vi.fn();
const invalidateLocationsCacheMock = vi.fn();

vi.mock("next-auth", () => ({
  getServerSession: (...args) => getServerSessionMock(...args),
}));

vi.mock("@/lib/db", () => ({
  dbConnect: (...args) => dbConnectMock(...args),
  LocationCity: {
    findOne: (...args) => findOneMock(...args),
    find: (...args) => findMock(...args),
    create: (...args) => createMock(...args),
  },
}));

vi.mock("@/lib/locations", () => ({
  bumpLocationsVersion: (...args) => bumpLocationsVersionMock(...args),
  invalidateLocationsCache: (...args) => invalidateLocationsCacheMock(...args),
}));

import { GET, POST } from "./route";

describe("admin city locations route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("rejects unauthorized access", async () => {
    getServerSessionMock.mockResolvedValue({ user: { role: "user" } });
    const response = await GET();
    expect(response.status).toBe(401);
  });

  test("returns city list for admins", async () => {
    getServerSessionMock.mockResolvedValue({ user: { role: "admin" } });
    findMock.mockReturnValue({
      sort: () => ({
        lean: () => ({
          exec: () => Promise.resolve([{ cityId: "harare", cityName: "Harare", active: true }]),
        }),
      }),
    });
    const response = await GET();
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(Array.isArray(payload.cities)).toBe(true);
    expect(payload.cities[0].city_name).toBe("Harare");
  });

  test("creates city and bumps version", async () => {
    getServerSessionMock.mockResolvedValue({ user: { role: "admin" } });
    findOneMock
      .mockReturnValueOnce({ lean: () => ({ exec: () => Promise.resolve(null) }) })
      .mockReturnValueOnce({ lean: () => ({ exec: () => Promise.resolve(null) }) });
    createMock.mockResolvedValue({ cityId: "harare", cityName: "Harare" });

    const response = await POST(
      new Request("http://localhost/api/admin/locations/cities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ city_name: "Harare" }),
      }),
    );

    expect(response.status).toBe(201);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(bumpLocationsVersionMock).toHaveBeenCalledTimes(1);
    expect(invalidateLocationsCacheMock).toHaveBeenCalledTimes(1);
  });

  test("rejects duplicate city names", async () => {
    getServerSessionMock.mockResolvedValue({ user: { role: "admin" } });
    findOneMock.mockReturnValueOnce({
      lean: () => ({ exec: () => Promise.resolve({ cityId: "harare" }) }),
    });

    const response = await POST(
      new Request("http://localhost/api/admin/locations/cities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ city_name: "Harare" }),
      }),
    );
    expect(response.status).toBe(409);
  });
});
