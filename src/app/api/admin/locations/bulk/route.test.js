import { beforeEach, describe, expect, test, vi } from "vitest";

const getServerSessionMock = vi.fn();
const dbConnectMock = vi.fn();
const cityUpdateManyMock = vi.fn();
const suburbUpdateManyMock = vi.fn();
const cityDeleteManyMock = vi.fn();
const suburbDeleteManyMock = vi.fn();
const suburbCountDocumentsMock = vi.fn();
const bumpLocationsVersionMock = vi.fn();
const invalidateLocationsCacheMock = vi.fn();

vi.mock("next-auth", () => ({
  getServerSession: (...args) => getServerSessionMock(...args),
}));

vi.mock("@/lib/db", () => ({
  dbConnect: (...args) => dbConnectMock(...args),
  LocationCity: {
    updateMany: (...args) => cityUpdateManyMock(...args),
    deleteMany: (...args) => cityDeleteManyMock(...args),
  },
  LocationSuburb: {
    updateMany: (...args) => suburbUpdateManyMock(...args),
    deleteMany: (...args) => suburbDeleteManyMock(...args),
    countDocuments: (...args) => suburbCountDocumentsMock(...args),
  },
}));

vi.mock("@/lib/locations", () => ({
  bumpLocationsVersion: (...args) => bumpLocationsVersionMock(...args),
  invalidateLocationsCache: (...args) => invalidateLocationsCacheMock(...args),
}));

import { POST } from "./route";

describe("POST /api/admin/locations/bulk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("rejects unauthorized calls", async () => {
    getServerSessionMock.mockResolvedValue({ user: { role: "user" } });
    const response = await POST(
      new Request("http://localhost/api/admin/locations/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "cities", action: "activate", ids: ["harare"] }),
      }),
    );
    expect(response.status).toBe(401);
  });

  test("runs harare_only action", async () => {
    getServerSessionMock.mockResolvedValue({ user: { role: "admin" } });
    cityUpdateManyMock.mockResolvedValue({ modifiedCount: 1 });
    suburbUpdateManyMock.mockResolvedValue({ modifiedCount: 1 });

    const response = await POST(
      new Request("http://localhost/api/admin/locations/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "cities", action: "harare_only", ids: [] }),
      }),
    );

    expect(response.status).toBe(200);
    expect(cityUpdateManyMock).toHaveBeenCalled();
    expect(suburbUpdateManyMock).toHaveBeenCalled();
    expect(bumpLocationsVersionMock).toHaveBeenCalledTimes(1);
    expect(invalidateLocationsCacheMock).toHaveBeenCalledTimes(1);
  });
});
