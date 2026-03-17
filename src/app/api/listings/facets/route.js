import { getListingFacets } from "@/lib/getListings";

export const runtime = "nodejs";

export async function GET() {
  try {
    const facets = await getListingFacets();
    return Response.json({
      cities: Array.isArray(facets?.cities) ? facets.cities : [],
      suburbsByCity:
        facets?.suburbsByCity && typeof facets.suburbsByCity === "object"
          ? facets.suburbsByCity
          : {},
    });
  } catch {
    return Response.json({ cities: [], suburbsByCity: {} });
  }
}
