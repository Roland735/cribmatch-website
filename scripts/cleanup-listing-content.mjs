import fs from "node:fs/promises";
import path from "node:path";
import { MongoClient } from "mongodb";

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
  for (const name of [".env.local", ".env"]) {
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
    } catch { }
  }
}

function safeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function suburbLabel(suburb) {
  const raw = safeString(suburb);
  if (!raw) return "the area";
  return raw.split(",")[0]?.trim() || raw;
}

function cityLabel(city, suburb) {
  const direct = safeString(city);
  if (direct) return direct;
  const rawSuburb = safeString(suburb);
  if (!rawSuburb.includes(",")) return "";
  const parts = rawSuburb.split(",").map((part) => part.trim()).filter(Boolean);
  return parts[parts.length - 1] || "";
}

function buildDescription(listing) {
  const category = safeString(listing.propertyCategory) || "residential";
  const type = safeString(listing.propertyType) || "property";
  const suburb = suburbLabel(listing.suburb);
  const city = cityLabel(listing.city, listing.suburb);
  const location = city ? `${suburb}, ${city}` : suburb;
  const bedsRaw = Number(listing.bedrooms);
  const beds = Number.isFinite(bedsRaw) ? Math.max(0, Math.floor(bedsRaw)) : 0;
  const priceRaw = Number(listing.pricePerMonth);
  const price = Number.isFinite(priceRaw) ? Math.max(0, Math.round(priceRaw)) : null;
  const features = Array.isArray(listing.features)
    ? listing.features.filter((item) => typeof item === "string" && item.trim()).slice(0, 3)
    : [];
  const featuresText = features.length ? ` Features include ${features.join(", ")}.` : "";
  if (category === "boarding") {
    return `Well-maintained boarding accommodation in ${location}, suitable for students and young professionals. Clean shared spaces and practical amenities are available for comfortable daily living.${featuresText}`;
  }
  if (category === "rent_a_chair") {
    return `Professional rent-a-chair setup in ${location}, ideal for service providers looking for a ready-to-use workspace with reliable client access.${featuresText}`;
  }
  if (category === "commercial") {
    return `Commercial ${type.toLowerCase()} available in ${location}, suitable for business operations and customer-facing services.${featuresText}`;
  }
  if (category === "land") {
    return `Land parcel available in ${location}, suitable for future development or investment opportunities in a growing area.`;
  }
  const bedText = beds > 0 ? `${beds}-bedroom ` : "";
  const priceText = price !== null ? ` at around $${price} per month` : "";
  return `Neat ${bedText}${type.toLowerCase()} in ${location}${priceText}. This listing offers practical living space in a convenient neighborhood.${featuresText}`;
}

function buildTitle(listing) {
  const category = safeString(listing.propertyCategory) || "residential";
  const type = safeString(listing.propertyType) || "Property";
  const suburb = suburbLabel(listing.suburb);
  const bedsRaw = Number(listing.bedrooms);
  const beds = Number.isFinite(bedsRaw) ? Math.max(0, Math.floor(bedsRaw)) : 0;
  if (category === "boarding") return `Boarding accommodation in ${suburb}`;
  if (category === "rent_a_chair") return `Rent a chair space in ${suburb}`;
  if (category === "commercial") return `${type} to let in ${suburb}`;
  if (category === "land") return `Land for sale in ${suburb}`;
  return beds > 0 ? `${beds}-bed ${type} in ${suburb}` : `${type} in ${suburb}`;
}

async function main() {
  await loadEnvFiles();
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set");
  }

  const client = new MongoClient(uri);
  await client.connect();
  const collection = client.db().collection("listings");
  const listings = await collection.find({}).toArray();

  let scanned = 0;
  let updated = 0;
  let descUpdated = 0;
  let titleUpdated = 0;
  const ops = [];

  for (const listing of listings) {
    scanned += 1;
    const next = {
      title: buildTitle(listing),
      description: buildDescription(listing),
      updatedAt: new Date(),
    };
    descUpdated += 1;
    titleUpdated += 1;
    ops.push({
      updateOne: {
        filter: { _id: listing._id },
        update: { $set: next },
      },
    });
    updated += 1;
  }

  if (ops.length) {
    await collection.bulkWrite(ops, { ordered: false });
  }

  console.log(JSON.stringify({ scanned, updated, descUpdated, titleUpdated }, null, 2));
  await client.close();
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
