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
  const users = db.collection("users");
  const pricing = db.collection("pricingsettings");

  const now = new Date();

  await listings.updateMany(
    { listerType: { $exists: false } },
    {
      $set: {
        listerType: "direct_landlord",
        approvalStatus: "pending",
        approvedByAdminId: "",
        approvedAt: null,
        approvalReason: "Backfilled by migration",
        agentRate: null,
        agentFixedFee: null,
      },
      $setOnInsert: {},
    },
  );

  await listings.updateMany(
    { approvalHistory: { $exists: false } },
    {
      $set: {
        approvalHistory: [
          {
            status: "pending",
            adminId: "",
            reason: "Backfilled by migration",
            changedAt: now,
          },
        ],
      },
    },
  );

  await users.updateMany(
    { agentProfile: { $exists: false } },
    {
      $set: {
        agentProfile: {
          fullLegalName: "",
          contactEmail: "",
          contactPhone: "",
          governmentIdNumber: "",
          agencyLicenseNumber: "",
          agencyAffiliationProof: "",
          agencyName: "",
          commissionRatePercent: null,
          fixedFee: null,
          verificationStatus: "none",
          verificationSubmittedAt: null,
          verifiedAt: null,
          rejectedAt: null,
          listingsFrozen: false,
        },
      },
    },
  );

  await users.updateMany(
    { agentVerificationHistory: { $exists: false } },
    { $set: { agentVerificationHistory: [] } },
  );
  await users.updateMany(
    { agentRateHistory: { $exists: false } },
    { $set: { agentRateHistory: [] } },
  );

  await pricing.updateMany(
    { agentPriceDiscountPercent: { $exists: false } },
    { $set: { agentPriceDiscountPercent: 5 } },
  );

  await client.close();
  console.log("Agent management migration completed.");
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exitCode = 1;
});
