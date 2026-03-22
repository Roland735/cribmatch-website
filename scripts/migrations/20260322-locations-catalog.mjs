import fs from "node:fs/promises";
import path from "node:path";
import { MongoClient } from "mongodb";

const DEFAULT_CITIES = [
  "Harare",
];

const DEFAULT_SUBURBS_BY_CITY = {
  Harare: ["Borrowdale", "Mount Pleasant", "Avondale", "Highlands", "Belgravia", "Mabelreign", "Eastlea", "Chisipite", "Glen Lorne", "Greendale", "Gunhill"],
};

function parseEnvLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const equalsIndex = trimmed.indexOf("=");
  if (equalsIndex <= 0) return null;
  const key = trimmed.slice(0, equalsIndex).trim();
  let value = trimmed.slice(equalsIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  if (!key) return null;
  return { key, value };
}

async function loadEnvFiles() {
  const root = process.cwd();
  const candidates = [".env.local", ".env"];
  for (const name of candidates) {
    const filePath = path.join(root, name);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const parsed = parseEnvLine(line);
        if (!parsed) continue;
        if (process.env[parsed.key] === undefined) {
          process.env[parsed.key] = parsed.value;
        }
      }
    } catch {
    }
  }
}

function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function toSlug(value) {
  return normalizeName(value)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function parseSuburbAndCity(value) {
  const raw = normalizeName(value);
  if (!raw) return { suburb: "", city: "" };
  const parts = raw.split(",").map((part) => normalizeName(part)).filter(Boolean);
  if (parts.length < 2) return { suburb: parts[0] || "", city: "" };
  return { suburb: parts[0], city: parts[parts.length - 1] };
}

async function main() {
  await loadEnvFiles();
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error("MONGODB_URI is required");
  }

  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db();

  const listings = db.collection("listings");
  const locationCities = db.collection("locationcities");
  const locationSuburbs = db.collection("locationsuburbs");
  const locationCatalogs = db.collection("locationcatalogs");

  const listingSuburbs = await listings.distinct("suburb", {});

  const citySet = new Set(DEFAULT_CITIES.map((city) => normalizeName(city)).filter(Boolean));

  const cityDocs = Array.from(citySet).map((cityName) => ({
    cityId: toSlug(cityName),
    cityName,
    cityNameLower: cityName.toLowerCase(),
    active: true,
  })).filter((city) => city.cityId && city.cityName);

  if (cityDocs.length) {
    await locationCities.bulkWrite(
      cityDocs.map((city) => ({
        updateOne: {
          filter: { cityId: city.cityId },
          update: { $set: city },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  const cityRows = await locationCities.find({}, { projection: { _id: 1, cityId: 1, cityName: 1 } }).toArray();
  const cityRefById = new Map(cityRows.map((row) => [row.cityId, row]));
  const defaultCityId = toSlug("Harare");

  await locationCities.updateMany({ cityId: { $ne: defaultCityId } }, { $set: { active: false } });

  const suburbByKey = new Map();
  for (const [cityName, suburbs] of Object.entries(DEFAULT_SUBURBS_BY_CITY)) {
    const cityId = toSlug(cityName);
    for (const suburbRaw of suburbs) {
      const suburbName = normalizeName(suburbRaw);
      if (!suburbName) continue;
      suburbByKey.set(`${cityId}:${suburbName.toLowerCase()}`, { cityId, suburbName });
    }
  }
  for (const suburbLine of Array.isArray(listingSuburbs) ? listingSuburbs : []) {
    const parsed = parseSuburbAndCity(suburbLine);
    const suburbName = normalizeName(parsed.suburb);
    if (!suburbName) continue;
    const cityId = toSlug(parsed.city || "Harare");
    if (cityId !== defaultCityId) continue;
    suburbByKey.set(`${cityId}:${suburbName.toLowerCase()}`, { cityId, suburbName });
  }

  const suburbDocs = Array.from(suburbByKey.values()).map((entry) => {
    const cityRef = cityRefById.get(entry.cityId) || cityRefById.get(defaultCityId);
    if (!cityRef?._id) return null;
    return {
      suburbId: toSlug(`${entry.suburbName}_${cityRef.cityId}`),
      suburbName: entry.suburbName,
      suburbNameLower: entry.suburbName.toLowerCase(),
      cityId: cityRef.cityId,
      cityRef: cityRef._id,
      active: cityRef.cityId === defaultCityId,
    };
  }).filter(Boolean);

  if (suburbDocs.length) {
    await locationSuburbs.bulkWrite(
      suburbDocs.map((suburb) => ({
        updateOne: {
          filter: { cityId: suburb.cityId, suburbNameLower: suburb.suburbNameLower },
          update: { $set: suburb },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  await locationSuburbs.updateMany({ cityId: { $ne: defaultCityId } }, { $set: { active: false } });

  await locationCatalogs.updateOne(
    { _id: "default" },
    {
      $set: { updatedAtMs: Date.now() },
      $inc: { version: 1 },
      $setOnInsert: { version: 1 },
    },
    { upsert: true },
  );

  await client.close();
  console.log("Locations migration completed.");
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exitCode = 1;
});
