import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { inferCityFromSuburb, searchPublishedListings } from "./getListings";

describe("inferCityFromSuburb", () => {
  test("extracts city from suburb values with comma format", () => {
    expect(inferCityFromSuburb("CBD, Bulawayo")).toBe("Bulawayo");
    expect(inferCityFromSuburb("Mount Pleasant, Harare")).toBe("Harare");
  });

  test("returns empty string when suburb has no city suffix", () => {
    expect(inferCityFromSuburb("Avondale")).toBe("");
  });
});

describe("searchPublishedListings (seed fallback integration)", () => {
  const originalMongoUri = process.env.MONGODB_URI;

  beforeAll(() => {
    delete process.env.MONGODB_URI;
  });

  afterAll(() => {
    if (typeof originalMongoUri === "string" && originalMongoUri.length) {
      process.env.MONGODB_URI = originalMongoUri;
      return;
    }
    delete process.env.MONGODB_URI;
  });

  test("returns matches for multi-term search", async () => {
    const result = await searchPublishedListings({ q: "solar borehole" });
    const ids = result.listings.map((listing) => String(listing._id));
    expect(ids).toContain("seed-mountpleasant-1");
  });

  test("returns city matches using city and suburb text", async () => {
    const result = await searchPublishedListings({
      city: "Harare East",
      minBeds: 3,
      maxPrice: 500,
    });
    const ids = result.listings.map((listing) => String(listing._id));
    expect(ids).toContain("seed-ruwa-1");
  });

  test("returns expected listing when search is filtered by type and feature", async () => {
    const result = await searchPublishedListings({
      propertyCategory: "commercial",
      propertyType: "Warehouse",
      q: "loading bay",
      features: ["Parking"],
    });
    const ids = result.listings.map((listing) => String(listing._id));
    expect(ids).toContain("seed-msasa-1");
  });

  test("returns expected listing under default search with a valid keyword", async () => {
    const result = await searchPublishedListings({ q: "borehole" });
    const ids = result.listings.map((listing) => String(listing._id));
    expect(ids).toContain("seed-avondale-1");
  });
});
