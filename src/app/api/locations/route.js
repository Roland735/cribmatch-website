import { getLocationsSnapshot } from "@/lib/locations";

export const runtime = "nodejs";

function toSafeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request) {
  try {
    const snapshot = await getLocationsSnapshot();
    const url = new URL(request.url);
    const cityId = toSafeString(url.searchParams.get("cityId")).toLowerCase();
    const ifNoneMatch = toSafeString(request.headers.get("if-none-match"));
    const etag = `"locations-${snapshot.version}"`;

    if (ifNoneMatch === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: etag,
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        },
      });
    }

    const suburbs = cityId
      ? snapshot.suburbs.filter((suburb) => suburb.city_id === cityId)
      : snapshot.suburbs;

    const suburbsByCity = cityId
      ? Object.fromEntries(
          Object.entries(snapshot.suburbsByCity || {}).filter(([cityName]) => {
            const city = snapshot.cities.find(
              (item) => item.city_name.toLowerCase() === String(cityName).toLowerCase(),
            );
            return city?.city_id === cityId;
          }),
        )
      : snapshot.suburbsByCity;

    return Response.json(
      {
        version: snapshot.version,
        cities: snapshot.cities,
        suburbs,
        suburbsByCity,
      },
      {
        headers: {
          ETag: etag,
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        },
      },
    );
  } catch {
    return Response.json(
      { version: 1, cities: [], suburbs: [], suburbsByCity: {} },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
