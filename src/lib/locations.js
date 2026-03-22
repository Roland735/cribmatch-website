import { dbConnect, LocationCatalog, LocationCity, LocationSuburb } from "@/lib/db";

const FALLBACK_CITY_NAMES = [
  "Harare",
];

const HARARE_SUBURBS = [
  "Arcadia",
  "Ardbennie",
  "Ashdown Park",
  "Aspindale Park",
  "Avondale",
  "Avenues",
  "Ballas",
  "Belgravia",
  "Belvedere",
  "Bluff Hill",
  "Borrowdale",
  "Borrowdale Brooke",
  "Braeside",
  "Budiriro",
  "CBD",
  "Chadcombe",
  "Chisipite",
  "Cleveland",
  "Colne Valley",
  "Cranborne",
  "Crowborough",
  "Dzivarasekwa",
  "Eastlea",
  "Eastview",
  "Emerald Hill",
  "Epworth",
  "Graniteside",
  "Greendale",
  "Glen Lorne",
  "Glen Norah",
  "Glen View",
  "Glen Forest",
  "Gunhill",
  "Hatcliffe",
  "Hatfield",
  "Helensvale",
  "Highfield",
  "Highlands",
  "Hillside",
  "Hogerty Hill",
  "Houghton Park",
  "Kambuzuma",
  "Kensington",
  "Komarock",
  "Kuwadzana",
  "Letombo Park",
  "Mabelreign",
  "Mandara",
  "Marlborough",
  "Mbare",
  "Meyrick Park",
  "Milton Park",
  "Mount Hampden",
  "Mount Pleasant",
  "Msasa",
  "Newlands",
  "Prospect",
  "Quinnington",
  "Ridgeview",
  "Rolf Valley",
  "Rugare",
  "Sandton Park",
  "Sentosa",
  "Shawasha Hills",
  "Southerton",
  "Strathaven",
  "Sunningdale",
  "Sunridge",
  "Tafara",
  "The Grange",
  "Tynwald",
  "Tynwald South",
  "Vainona",
  "Warren Park",
  "Waterfalls",
  "Westgate",
  "Westlea",
  "Willowvale",
  "Windsor Park",
  "Workington",
  "Woodlands",
  "Zimre Park",
];

const FALLBACK_SUBURBS_BY_CITY = {
  Harare: HARARE_SUBURBS,
};

function toSafeString(value) {
  return typeof value === "string" ? value : "";
}

function normalizeName(value) {
  return toSafeString(value).trim().replace(/\s+/g, " ");
}

function toSlug(value) {
  return normalizeName(value)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function uniqueSorted(values = []) {
  return Array.from(
    new Set(values.map((value) => normalizeName(value)).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b));
}

function buildSnapshot({ cities = [], suburbs = [], version = 1 } = {}) {
  const cityMap = new Map();
  for (const city of Array.isArray(cities) ? cities : []) {
    const cityName = normalizeName(city.city_name);
    const cityId = toSlug(city.city_id || cityName);
    if (!cityName || !cityId) continue;
    cityMap.set(cityId, { city_id: cityId, city_name: cityName });
  }

  const suburbList = [];
  for (const suburb of Array.isArray(suburbs) ? suburbs : []) {
    const cityId = toSlug(suburb.city_id);
    const suburbName = normalizeName(suburb.suburb_name);
    const suburbId = toSlug(suburb.suburb_id || `${suburbName}_${cityId}`);
    const cityEntry = cityMap.get(cityId);
    if (!cityEntry || !suburbName || !suburbId) continue;
    suburbList.push({
      suburb_id: suburbId,
      suburb_name: suburbName,
      city_id: cityId,
      city_name: cityEntry.city_name,
    });
  }

  const suburbsByCity = {};
  for (const city of cityMap.values()) {
    suburbsByCity[city.city_name] = [];
  }
  for (const suburb of suburbList) {
    if (!Array.isArray(suburbsByCity[suburb.city_name])) {
      suburbsByCity[suburb.city_name] = [];
    }
    suburbsByCity[suburb.city_name].push(suburb.suburb_name);
  }
  for (const cityName of Object.keys(suburbsByCity)) {
    suburbsByCity[cityName] = uniqueSorted(suburbsByCity[cityName]);
  }

  const cityList = Array.from(cityMap.values()).sort((a, b) =>
    a.city_name.localeCompare(b.city_name),
  );
  const suburbsSorted = suburbList.sort((a, b) => {
    const byCity = a.city_name.localeCompare(b.city_name);
    if (byCity !== 0) return byCity;
    return a.suburb_name.localeCompare(b.suburb_name);
  });

  return {
    version: Number(version) > 0 ? Number(version) : 1,
    cities: cityList,
    suburbs: suburbsSorted,
    suburbsByCity,
  };
}

function buildFallbackSnapshot() {
  const cities = uniqueSorted(FALLBACK_CITY_NAMES).map((cityName) => ({
    city_id: toSlug(cityName),
    city_name: cityName,
  }));
  const suburbs = [];
  for (const [cityName, suburbNames] of Object.entries(FALLBACK_SUBURBS_BY_CITY)) {
    const cityId = toSlug(cityName);
    for (const suburbNameRaw of uniqueSorted(suburbNames)) {
      suburbs.push({
        suburb_id: toSlug(`${suburbNameRaw}_${cityName}`),
        suburb_name: suburbNameRaw,
        city_id: cityId,
      });
    }
  }
  return buildSnapshot({ cities, suburbs, version: 1 });
}

let cache = { value: null, ts: 0 };
const CACHE_MS = 60 * 1000;

export function invalidateLocationsCache() {
  cache = { value: null, ts: 0 };
}

export async function bumpLocationsVersion() {
  if (!process.env.MONGODB_URI) return 1;
  await dbConnect();
  const now = Date.now();
  const updated = await LocationCatalog.findOneAndUpdate(
    { _id: "default" },
    {
      $inc: { version: 1 },
      $set: { updatedAtMs: now },
      $setOnInsert: { version: 1 },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  )
    .lean()
    .exec();
  invalidateLocationsCache();
  return Number(updated?.version || 1);
}

async function loadLocationsFromDatabase() {
  if (!process.env.MONGODB_URI) return null;
  await dbConnect();
  const [citiesRows, suburbsRows, catalog] = await Promise.all([
    LocationCity.find(
      { $or: [{ active: true }, { active: { $exists: false } }] },
      { cityId: 1, cityName: 1, _id: 0 },
    )
      .sort({ cityNameLower: 1 })
      .lean()
      .exec(),
    LocationSuburb.find(
      { $or: [{ active: true }, { active: { $exists: false } }] },
      { suburbId: 1, suburbName: 1, cityId: 1, _id: 0 },
    )
      .sort({ cityId: 1, suburbNameLower: 1 })
      .lean()
      .exec(),
    LocationCatalog.findById("default").lean().exec(),
  ]);

  if (!Array.isArray(citiesRows) || !citiesRows.length) return null;

  const cities = citiesRows.map((city) => ({
    city_id: toSlug(city?.cityId),
    city_name: normalizeName(city?.cityName),
  }));
  const suburbs = (Array.isArray(suburbsRows) ? suburbsRows : []).map((suburb) => ({
    suburb_id: toSlug(suburb?.suburbId),
    suburb_name: normalizeName(suburb?.suburbName),
    city_id: toSlug(suburb?.cityId),
  }));

  return buildSnapshot({
    cities,
    suburbs,
    version: Number(catalog?.version || 1),
  });
}

export async function getLocationsSnapshot({ skipCache = false } = {}) {
  const now = Date.now();
  if (!skipCache && cache.value && now - cache.ts < CACHE_MS) return cache.value;
  try {
    const fromDb = await loadLocationsFromDatabase();
    const value = fromDb || buildFallbackSnapshot();
    cache = { value, ts: now };
    return value;
  } catch {
    const fallback = cache.value || buildFallbackSnapshot();
    cache = { value: fallback, ts: now };
    return fallback;
  }
}

export function toWhatsappLocationOptions(snapshot, { includeAny = true } = {}) {
  const safe = snapshot && typeof snapshot === "object" ? snapshot : buildFallbackSnapshot();
  const cities = (Array.isArray(safe.cities) ? safe.cities : []).map((city) => ({
    id: city.city_id,
    title: city.city_name,
  }));
  const suburbs = (Array.isArray(safe.suburbs) ? safe.suburbs : []).map((suburb) => ({
    id: suburb.suburb_id,
    title: suburb.suburb_name,
    city_id: suburb.city_id,
  }));
  if (!includeAny) {
    return { cities, suburbs };
  }
  return {
    cities,
    suburbs: [{ id: "any", title: "Any" }, ...suburbs],
  };
}
