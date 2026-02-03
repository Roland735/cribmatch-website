import fs from "node:fs/promises";
import path from "node:path";
import { MongoClient } from "mongodb";
import crypto from "node:crypto";

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
    } catch { }
  }
}

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    reset: args.has("--reset") || args.has("--force"),
    allSuburbs: args.has("--all-suburbs") || args.has("--all"),
    resetPasswords: args.has("--reset-passwords") || args.has("--reset-password"),
  };
}

async function loadSeedListings() {
  const filePath = path.join(
    process.cwd(),
    "src",
    "lib",
    "seedListings.json",
  );
  const raw = await fs.readFile(filePath, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) return [];
  return data.filter((item) => item && typeof item === "object");
}

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64");
  const derivedKey = await scryptAsync(password, salt);
  return { salt, hash: derivedKey.toString("base64") };
}

function normalizeIdPart(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

function generatePhotoSet(index) {
  const sets = [
    [
      "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=1400&q=80",
      "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1400&q=80",
      "https://images.unsplash.com/photo-1484154218962-a197022b5858?auto=format&fit=crop&w=1400&q=80",
    ],
    [
      "https://images.unsplash.com/photo-1523217582562-09d0def993a6?auto=format&fit=crop&w=1400&q=80",
      "https://images.unsplash.com/photo-1493809842364-78817add7ffb?auto=format&fit=crop&w=1400&q=80",
      "https://images.unsplash.com/photo-1502005229762-cf1b2da7c5d6?auto=format&fit=crop&w=1400&q=80",
    ],
    [
      "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1400&q=80",
      "https://images.unsplash.com/photo-1502672023488-70e25813eb80?auto=format&fit=crop&w=1400&q=80",
      "https://images.unsplash.com/photo-1501183638710-841dd1904471?auto=format&fit=crop&w=1400&q=80",
    ],
    [
      "https://images.unsplash.com/photo-1507089947368-19c1da9775ae?auto=format&fit=crop&w=1400&q=80",
      "https://images.unsplash.com/photo-1560448075-bb4a4f1b9e45?auto=format&fit=crop&w=1400&q=80",
      "https://images.unsplash.com/photo-1560449752-64f51f8f54f7?auto=format&fit=crop&w=1400&q=80",
    ],
    [
      "https://images.unsplash.com/photo-1521334726092-b509a19597c6?auto=format&fit=crop&w=1400&q=80",
      "https://images.unsplash.com/photo-1529421308418-eab98863cee4?auto=format&fit=crop&w=1400&q=80",
      "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1400&q=80",
    ],
  ];
  return sets[index % sets.length];
}

function pickResidentialType(index) {
  const types = ["Apartment", "House", "Cottage", "Garden flat", "Townhouse"];
  return types[index % types.length];
}

function generateListingForSuburb({ suburb, index, lister }) {
  const bedrooms = (index % 4) + 1;
  const propertyType = pickResidentialType(index);
  const basePrice = 180 + bedrooms * 90;
  const pricePerMonth = basePrice + (index % 7) * 10;
  const deposit = pricePerMonth;

  return {
    _id: `seed-${normalizeIdPart(suburb)}`,
    title: `${suburb.split(",")[0]}: ${bedrooms}-bed ${propertyType.toLowerCase()} (photos)`,
    listerPhoneNumber: lister.phoneNumber,
    suburb,
    propertyCategory: "residential",
    propertyType,
    pricePerMonth,
    deposit,
    bedrooms,
    description:
      "Sample listing for seeding: clean, secure, and close to transport. Contact via WhatsApp to schedule a viewing.",
    features: [
      "Walled & gated",
      "Secure parking",
      "Water available",
      bedrooms >= 3 ? "Garden" : "Close to transport",
      index % 3 === 0 ? "Borehole" : "Prepaid ZESA",
    ],
    images: generatePhotoSet(index),
    contactName: lister.name,
    contactWhatsApp: lister.phoneNumber,
    contactPhone: lister.phoneNumber,
    contactEmail: lister.email,
    status: "published",
    createdAt: new Date(Date.UTC(2026, 0, 1 + (index % 28), 10, 0, 0)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 0, 1 + (index % 28), 10, 0, 0)).toISOString(),
  };
}

function buildSeedUsers() {
  const admin = {
    _id: "+263770000001",
    name: "CribMatch Admin",
    role: "admin",
    email: "admin@cribmatch.org",
    plainPassword: "admin12345",
  };

  const agents = Array.from({ length: 12 }).map((_, idx) => {
    const n = String(idx + 1).padStart(2, "0");
    return {
      _id: `+2637710000${n}`,
      name: `CribMatch Agent ${idx + 1}`,
      role: "agent",
      email: `agent${idx + 1}@cribmatch.org`,
      plainPassword: "agent12345",
    };
  });

  const users = Array.from({ length: 20 }).map((_, idx) => {
    const n = String(idx + 1).padStart(2, "0");
    return {
      _id: `+2637720000${n}`,
      name: `Test User ${idx + 1}`,
      role: "user",
      email: `user${idx + 1}@cribmatch.org`,
      plainPassword: "user12345",
    };
  });

  return { admin, agents, users };
}

function generateAllSuburbSeedListings(agents) {
  const extraCities = [
    "Beitbridge",
    "Bindura",
    "Bulawayo",
    "Chegutu",
    "Chinhoyi",
    "Chiredzi",
    "Chipinge",
    "Chitungwiza",
    "Gokwe",
    "Gwanda",
    "Gweru",
    "Harare",
    "Hwange",
    "Kadoma",
    "Kariba",
    "Karoi",
    "Kwekwe",
    "Masvingo",
    "Marondera",
    "Mutare",
    "Norton",
    "Plumtree",
    "Rusape",
    "Ruwa",
    "Victoria Falls",
    "Zvishavane",
  ];

  const harareSuburbs = [
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

  const harareExtras = harareSuburbs.map((name) => `${name}, Harare`);
  const otherCityEntries = extraCities
    .filter((city) => city !== "Harare")
    .map((city) => `CBD, ${city}`);

  const allSuburbs = Array.from(new Set([...harareExtras, ...otherCityEntries])).sort((a, b) =>
    a.localeCompare(b),
  );

  return allSuburbs.map((suburb, index) => {
    const agent = agents[index % agents.length];
    const lister = {
      phoneNumber: agent._id,
      name: agent.name,
      email: agent.email,
    };
    return generateListingForSuburb({ suburb, index, lister });
  });
}

async function main() {
  const { reset, allSuburbs, resetPasswords } = parseArgs(process.argv);

  await loadEnvFiles();

  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is not set");
  }

  const { admin, agents, users } = buildSeedUsers();

  const seedListingsRaw = allSuburbs ? generateAllSuburbSeedListings(agents) : await loadSeedListings();
  if (seedListingsRaw.length === 0) throw new Error("No seed listings found");

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();

  try {
    const db = client.db();
    const listingsCollection = db.collection("listings");
    const usersCollection = db.collection("users");

    if (resetPasswords) {
      const now = new Date();
      const existingUsers = await usersCollection
        .find({}, { projection: { _id: 1, role: 1 } })
        .toArray();

      const updates = await Promise.all(
        existingUsers.map(async (user) => {
          const role = user?.role === "admin" || user?.role === "agent" ? user.role : "user";
          const plainPassword =
            role === "admin" ? "admin12345" : role === "agent" ? "agent12345" : "user12345";
          const password = await hashPassword(plainPassword);
          return {
            updateOne: {
              filter: { _id: user._id },
              update: { $set: { password, updatedAt: now } },
            },
          };
        }),
      );

      if (updates.length) {
        await usersCollection.bulkWrite(updates, { ordered: false });
      }

      console.log(
        `Reset passwords for ${existingUsers.length} users (admin/agent/user -> admin12345/agent12345/user12345).`,
      );
      return;
    }

    const usersToInsert = [admin, ...agents, ...users];
    const now = new Date();
    const userDocs = await Promise.all(
      usersToInsert.map(async (u) => {
        const password = await hashPassword(u.plainPassword);
        return {
          _id: u._id,
          name: u.name,
          role: u.role,
          password,
          createdAt: now,
          updatedAt: now,
        };
      }),
    );

    const docs = seedListingsRaw.map((listing) => {
      const {
        createdAt: createdAtString,
        updatedAt: updatedAtString,
        ...rest
      } = listing;

      return {
        _id: listing._id,
        ...rest,
        createdAt: createdAtString ? new Date(createdAtString) : new Date(),
        updatedAt: updatedAtString ? new Date(updatedAtString) : new Date(),
      };
    });

    if (reset) {
      await Promise.all([listingsCollection.deleteMany({}), usersCollection.deleteMany({})]);
      await usersCollection.insertMany(userDocs, { ordered: true });
      await listingsCollection.insertMany(docs, { ordered: true });
    } else {
      await usersCollection.bulkWrite(
        userDocs.map((doc) => {
          const { _id, createdAt, ...rest } = doc;
          return {
            updateOne: {
              filter: { _id },
              update: { $set: { ...rest, updatedAt: new Date() }, $setOnInsert: { createdAt } },
              upsert: true,
            },
          };
        }),
        { ordered: false },
      );

      await listingsCollection.bulkWrite(
        docs.map((doc) => {
          const { _id, createdAt, ...rest } = doc;
          return {
            updateOne: {
              filter: { _id },
              update: { $set: { ...rest, updatedAt: new Date() }, $setOnInsert: { createdAt } },
              upsert: true,
            },
          };
        }),
        { ordered: false },
      );
    }

    const [totalListings, totalUsers] = await Promise.all([
      listingsCollection.countDocuments({}),
      usersCollection.countDocuments({}),
    ]);
    console.log(
      `Seeded ${docs.length} listings and ${userDocs.length} users. Totals: ${totalListings} listings, ${totalUsers} users.`,
    );
  } finally {
    await client.close();
  }
}

try {
  await main();
  process.exit(0);
} catch (error) {
  console.error(error?.message || error);
  process.exit(1);
}
