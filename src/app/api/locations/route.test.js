import { describe, expect, test, vi, beforeEach } from "vitest";

const getLocationsSnapshotMock = vi.fn();

vi.mock("@/lib/locations", () => ({
  getLocationsSnapshot: (...args) => getLocationsSnapshotMock(...args),
}));

import { GET } from "./route";

describe("GET /api/locations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns full locations payload and cache headers", async () => {
    getLocationsSnapshotMock.mockResolvedValue({
      version: 5,
      cities: [{ city_id: "harare", city_name: "Harare" }],
      suburbs: [{ suburb_id: "borrowdale_harare", suburb_name: "Borrowdale", city_id: "harare", city_name: "Harare" }],
      suburbsByCity: { Harare: ["Borrowdale"] },
    });

    const request = new Request("http://localhost/api/locations");
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe("\"locations-5\"");
    const payload = await response.json();
    expect(payload.version).toBe(5);
    expect(payload.cities).toHaveLength(1);
    expect(payload.suburbsByCity.Harare).toEqual(["Borrowdale"]);
  });

  test("returns 304 when etag matches", async () => {
    getLocationsSnapshotMock.mockResolvedValue({
      version: 9,
      cities: [],
      suburbs: [],
      suburbsByCity: {},
    });

    const request = new Request("http://localhost/api/locations", {
      headers: { "if-none-match": "\"locations-9\"" },
    });
    const response = await GET(request);
    expect(response.status).toBe(304);
  });
});
