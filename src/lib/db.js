import mongoose from "mongoose";

const uri = process.env.MONGODB_URI;

const globalForMongoose = globalThis;

let cached = globalForMongoose._mongoose;

if (!cached) {
  cached = { conn: null, promise: null };
  globalForMongoose._mongoose = cached;
}

export async function dbConnect() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    if (!uri) {
      cached.promise = Promise.reject(new Error("MONGODB_URI is not set"));
    } else {
      cached.promise = mongoose.connect(uri, { bufferCommands: false });
    }
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

function generateShortId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 4; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

async function findUniqueShortId(Model, attemptsLeft = 20) {
  if (!Model || attemptsLeft <= 0) throw new Error("Could not generate unique shortId");
  const candidate = generateShortId();
  const exists = await Model.exists({ shortId: candidate }).catch(() => null);
  if (!exists) return candidate;
  return findUniqueShortId(Model, attemptsLeft - 1);
}

function inferCityFromSuburb(suburb) {
  const raw = typeof suburb === "string" ? suburb.trim() : "";
  if (!raw.includes(",")) return "";
  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return "";
  return parts[parts.length - 1];
}

function normalizeLocationName(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeLocationKey(value) {
  return normalizeLocationName(value).toLowerCase();
}

const LocationCitySchema = new mongoose.Schema(
  {
    cityId: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    cityName: { type: String, required: true, trim: true },
    cityNameLower: { type: String, required: true, trim: true, lowercase: true, index: true },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

LocationCitySchema.pre("validate", function normalizeLocationCity() {
  this.cityName = normalizeLocationName(this.cityName);
  this.cityNameLower = normalizeLocationKey(this.cityName);
});

const LocationSuburbSchema = new mongoose.Schema(
  {
    suburbId: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    suburbName: { type: String, required: true, trim: true },
    suburbNameLower: { type: String, required: true, trim: true, lowercase: true, index: true },
    cityId: { type: String, required: true, trim: true, lowercase: true, index: true },
    cityRef: { type: mongoose.Schema.Types.ObjectId, ref: "LocationCity", required: true, index: true },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

LocationSuburbSchema.index({ cityId: 1, suburbNameLower: 1 }, { unique: true });

LocationSuburbSchema.pre("validate", function normalizeLocationSuburb() {
  this.suburbName = normalizeLocationName(this.suburbName);
  this.suburbNameLower = normalizeLocationKey(this.suburbName);
});

const LocationCatalogSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "default" },
    version: { type: Number, required: true, default: 1, min: 1 },
    updatedAtMs: { type: Number, required: true, default: () => Date.now() },
  },
  { timestamps: true },
);

export const LocationCity =
  mongoose.models.LocationCity || mongoose.model("LocationCity", LocationCitySchema);

export const LocationSuburb =
  mongoose.models.LocationSuburb || mongoose.model("LocationSuburb", LocationSuburbSchema);

export const LocationCatalog =
  mongoose.models.LocationCatalog || mongoose.model("LocationCatalog", LocationCatalogSchema);

const ListingSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    listerPhoneNumber: { type: String, required: true, trim: true, index: true },
    shortId: { type: String, trim: true, uppercase: true },
    city: { type: String, default: "Harare", trim: true, index: true },
    suburb: { type: String, required: true, trim: true },
    address: { type: String, default: "", trim: true },
    propertyCategory: {
      type: String,
      enum: ["residential", "commercial", "boarding", "rent_a_chair", "land"],
      default: "residential",
      index: true,
    },
    propertyType: { type: String, required: true, trim: true, index: true },
    pricePerMonth: { type: Number, required: true, min: 0 },
    deposit: { type: Number, default: null, min: 0 },
    bedrooms: { type: Number, required: true, min: 0 },
    description: { type: String, default: "", trim: true },
    features: { type: [String], default: [] },
    images: { type: [String], default: [] },
    contactName: { type: String, default: "", trim: true },
    contactPhone: { type: String, default: "", trim: true },
    contactWhatsApp: { type: String, default: "", trim: true },
    contactEmail: { type: String, default: "", trim: true },
    occupancy: { type: String, default: "", trim: true },
    genderPreference: { type: String, default: "", trim: true },
    duration: { type: String, default: "", trim: true },
    numberOfStudents: { type: Number, default: null, min: 0 },
    marketed: { type: Boolean, default: false, index: true },
    marketedAt: { type: Date, default: null, index: true },
    status: {
      type: String,
      enum: ["draft", "published", "archived"],
      default: "published",
      index: true,
    },
    approved: { type: Boolean, default: false, index: true },
    listerType: {
      type: String,
      enum: ["direct_landlord", "agent"],
      default: "direct_landlord",
      immutable: true,
      index: true,
    },
    agentRate: { type: Number, default: null, min: 0, max: 100 },
    agentFixedFee: { type: Number, default: null, min: 0 },
    agentProfileImageUrl: { type: String, default: "", trim: true },
    approvalStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    approvedByAdminId: { type: String, default: "", trim: true },
    approvedAt: { type: Date, default: null },
    approvalReason: { type: String, default: "", trim: true },
    approvalHistory: {
      type: [
        {
          status: {
            type: String,
            enum: ["pending", "approved", "rejected"],
            required: true,
          },
          adminId: { type: String, default: "", trim: true },
          reason: { type: String, default: "", trim: true },
          changedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

ListingSchema.index({ shortId: 1 }, { unique: true, sparse: true });
ListingSchema.index({ status: 1, approved: 1, city: 1, createdAt: -1 });
ListingSchema.index({ status: 1, approved: 1, propertyCategory: 1, propertyType: 1, createdAt: -1 });
ListingSchema.index({ status: 1, approved: 1, pricePerMonth: 1, createdAt: -1 });

ListingSchema.pre("validate", function normalizeLocationFields() {
  const inferred = inferCityFromSuburb(this.suburb);
  if (inferred) {
    const current = typeof this.city === "string" ? this.city.trim().toLowerCase() : "";
    const next = inferred.toLowerCase();
    if (!current || (current === "harare" && next !== "harare")) {
      this.city = inferred;
    }
  }
});

ListingSchema.pre("validate", function normalizeAgentFields() {
  if (this.listerType !== "agent") {
    this.agentRate = null;
    this.agentFixedFee = null;
  }
});

ListingSchema.pre("validate", async function ensureShortId() {
  try {
    if (this.shortId && typeof this.shortId === "string") {
      this.shortId = this.shortId.trim().toUpperCase();
      if (/^[A-Z0-9]{4}$/.test(this.shortId)) return;
      this.shortId = undefined;
    }

    if (this.shortId) return;

    const Model = this.constructor;
    // Ensure Model is available and has exists method
    if (!Model || typeof Model.exists !== "function") {
      // If this.constructor is not the model yet (rare), try looking it up
      const M = mongoose.models.Listing;
      if (M && typeof M.exists === "function") {
        this.shortId = await findUniqueShortId(M, 20);
        return;
      }
      console.warn("ListingSchema pre-validate: Model not found or invalid");
      return; // Skip shortId generation if model not ready
    }

    this.shortId = await findUniqueShortId(Model, 20);
  } catch (err) {
    console.error("ListingSchema pre-validate error:", err);
    throw err; // Re-throw to fail validation
  }
});

export const Listing =
  mongoose.models.Listing || mongoose.model("Listing", ListingSchema);

const UserSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true, trim: true },
    name: { type: String, default: "", trim: true },
    password: {
      salt: { type: String, required: true },
      hash: { type: String, required: true },
    },
    role: {
      type: String,
      enum: ["user", "agent", "admin"],
      default: "user",
      index: true,
    },
    whatsappVerified: { type: Boolean, default: false, index: true },
    whatsappVerifiedAt: { type: Date, default: null },
    adminContactNumber: { type: String, default: "", trim: true },
    agentProfile: {
      fullLegalName: { type: String, default: "", trim: true },
      contactEmail: { type: String, default: "", trim: true },
      contactPhone: { type: String, default: "", trim: true },
      alternatePhone: { type: String, default: "", trim: true },
      officeAddress: { type: String, default: "", trim: true },
      city: { type: String, default: "", trim: true },
      yearsExperience: { type: Number, default: null, min: 0 },
      areasServed: { type: [String], default: [] },
      specializations: { type: [String], default: [] },
      bio: { type: String, default: "", trim: true },
      preferredContactMethod: { type: String, default: "", trim: true },
      websiteUrl: { type: String, default: "", trim: true },
      governmentIdNumber: { type: String, default: "", trim: true },
      governmentIdImageUrl: { type: String, default: "", trim: true },
      agencyLicenseNumber: { type: String, default: "", trim: true },
      agencyAffiliationProof: { type: String, default: "", trim: true },
      agencyName: { type: String, default: "", trim: true },
      profileImageUrl: { type: String, default: "", trim: true },
      feePreference: {
        type: String,
        enum: ["commission", "fixed", "both"],
        default: "both",
      },
      commissionRatePercent: { type: Number, default: null, min: 0, max: 100 },
      fixedFee: { type: Number, default: null, min: 0 },
      verificationStatus: {
        type: String,
        enum: ["none", "pending_verification", "verified", "rejected", "pending_reapproval"],
        default: "none",
        index: true,
      },
      verificationSubmittedAt: { type: Date, default: null },
      verifiedAt: { type: Date, default: null },
      rejectedAt: { type: Date, default: null },
      listingsFrozen: { type: Boolean, default: false },
    },
    agentVerificationHistory: {
      type: [
        {
          fromStatus: { type: String, default: "", trim: true },
          toStatus: {
            type: String,
            enum: ["pending_verification", "verified", "rejected", "pending_reapproval"],
            required: true,
          },
          adminId: { type: String, default: "", trim: true },
          reason: { type: String, default: "", trim: true },
          changedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    agentRateHistory: {
      type: [
        {
          commissionRatePercent: { type: Number, default: null, min: 0, max: 100 },
          fixedFee: { type: Number, default: null, min: 0 },
          feePreference: {
            type: String,
            enum: ["commission", "fixed", "both"],
            default: "both",
          },
          changedBy: { type: String, default: "", trim: true },
          changedAt: { type: Date, default: Date.now },
          note: { type: String, default: "", trim: true },
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

export const User = mongoose.models.User || mongoose.model("User", UserSchema);

const OtpChallengeSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, trim: true, index: true },
    purpose: {
      type: String,
      required: true,
      enum: ["signup", "reset_password", "first_web_login"],
      index: true,
    },
    codeSalt: { type: String, required: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0, min: 0 },
    sendCount: { type: Number, default: 0, min: 0 },
    lastSentAt: { type: Date, default: null },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

OtpChallengeSchema.index({ phone: 1, purpose: 1 }, { unique: true });
OtpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

export const OtpChallenge =
  mongoose.models.OtpChallenge || mongoose.model("OtpChallenge", OtpChallengeSchema);

const WebhookEventSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true, trim: true, index: true },
    receivedAt: { type: Date, default: Date.now, index: true },
    headers: { type: Object, default: {} },
    payload: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { versionKey: false },
);

export const WebhookEvent =
  mongoose.models.WebhookEvent || mongoose.model("WebhookEvent", WebhookEventSchema);

const PurchaseSchema = new mongoose.Schema({
  phone: { type: String, required: true, index: true },
  listingId: { type: String, ref: 'Listing', required: true },
  listingSnapshot: { type: mongoose.Schema.Types.Mixed }, // Fallback for when listing is deleted or ID is generated
  createdAt: { type: Date, default: Date.now }
});
PurchaseSchema.index({ phone: 1, listingId: 1 }, { unique: true });

export const Purchase = mongoose.models.Purchase || mongoose.model("Purchase", PurchaseSchema);

const PaymentTransactionSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, index: true },
    payerMobile: { type: String, required: true, trim: true },
    listingId: { type: String, required: true, index: true },
    listingCode: { type: String, default: "", trim: true },
    listingTitle: { type: String, default: "", trim: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "USD", trim: true },
    gateway: { type: String, default: "paynow_ecocash", trim: true, index: true },
    status: {
      type: String,
      enum: ["created", "push_pending", "push_failed", "pending_confirmation", "paid", "cancelled", "failed", "verification_failed"],
      default: "created",
      index: true,
    },
    reference: { type: String, required: true, trim: true, index: true, unique: true },
    pollUrl: { type: String, default: "", trim: true },
    paynowReference: { type: String, default: "", trim: true },
    integrationId: { type: String, default: "", trim: true },
    company: { type: String, default: "", trim: true },
    paymentLinkLabel: { type: String, default: "", trim: true },
    retriesUsed: { type: Number, default: 0, min: 0 },
    attemptLogs: {
      type: [
        {
          stage: { type: String, required: true, trim: true },
          success: { type: Boolean, required: true },
          message: { type: String, default: "", trim: true },
          code: { type: String, default: "", trim: true },
          raw: { type: mongoose.Schema.Types.Mixed, default: null },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    verificationLogs: {
      type: [
        {
          success: { type: Boolean, required: true },
          status: { type: String, default: "", trim: true },
          paid: { type: Boolean, default: false },
          message: { type: String, default: "", trim: true },
          raw: { type: mongoose.Schema.Types.Mixed, default: null },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    unlockedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

PaymentTransactionSchema.index({ phone: 1, listingId: 1, status: 1, createdAt: -1 });

export const PaymentTransaction =
  mongoose.models.PaymentTransaction || mongoose.model("PaymentTransaction", PaymentTransactionSchema);

const ReportSchema = new mongoose.Schema({
  phone: { type: String, required: true, index: true },
  listingId: { type: String, ref: 'Listing', required: true },
  reason: { type: String, required: true },
  story: { type: String, default: "" },
  status: { type: String, enum: ['pending', 'reviewed', 'resolved'], default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

export const Report = mongoose.models.Report || mongoose.model("Report", ReportSchema);

const DEFAULT_PRICING_SETTINGS = {
  contactUnlockPriceUsd: 2.5,
  landlordListingPriceUsd: 0,
  agentPriceDiscountPercent: 5,
};

const PricingSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "default" },
    contactUnlockPriceUsd: { type: Number, required: true, min: 0, default: DEFAULT_PRICING_SETTINGS.contactUnlockPriceUsd },
    landlordListingPriceUsd: { type: Number, required: true, min: 0, default: DEFAULT_PRICING_SETTINGS.landlordListingPriceUsd },
    agentPriceDiscountPercent: { type: Number, required: true, min: 0, max: 100, default: DEFAULT_PRICING_SETTINGS.agentPriceDiscountPercent },
  },
  { timestamps: true },
);

export const PricingSettings =
  mongoose.models.PricingSettings || mongoose.model("PricingSettings", PricingSettingsSchema);

function normalizeMoney(value, fallback) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return fallback;
  return Math.round(amount * 100) / 100;
}

export async function getPricingSettings({ ensurePersisted = false } = {}) {
  await dbConnect();
  if (ensurePersisted) {
    const persisted = await PricingSettings.findOneAndUpdate(
      { _id: "default" },
      {
        $setOnInsert: {
          contactUnlockPriceUsd: DEFAULT_PRICING_SETTINGS.contactUnlockPriceUsd,
          landlordListingPriceUsd: DEFAULT_PRICING_SETTINGS.landlordListingPriceUsd,
          agentPriceDiscountPercent: DEFAULT_PRICING_SETTINGS.agentPriceDiscountPercent,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean().exec();
    return {
      contactUnlockPriceUsd: normalizeMoney(
        persisted?.contactUnlockPriceUsd,
        DEFAULT_PRICING_SETTINGS.contactUnlockPriceUsd,
      ),
      landlordListingPriceUsd: normalizeMoney(
        persisted?.landlordListingPriceUsd,
        DEFAULT_PRICING_SETTINGS.landlordListingPriceUsd,
      ),
      agentPriceDiscountPercent: normalizeMoney(
        persisted?.agentPriceDiscountPercent,
        DEFAULT_PRICING_SETTINGS.agentPriceDiscountPercent,
      ),
    };
  }

  const existing = await PricingSettings.findById("default").lean().exec();
  return {
    contactUnlockPriceUsd: normalizeMoney(
      existing?.contactUnlockPriceUsd,
      DEFAULT_PRICING_SETTINGS.contactUnlockPriceUsd,
    ),
    landlordListingPriceUsd: normalizeMoney(
      existing?.landlordListingPriceUsd,
      DEFAULT_PRICING_SETTINGS.landlordListingPriceUsd,
    ),
    agentPriceDiscountPercent: normalizeMoney(
      existing?.agentPriceDiscountPercent,
      DEFAULT_PRICING_SETTINGS.agentPriceDiscountPercent,
    ),
  };
}

export async function updatePricingSettings(input = {}) {
  const current = await getPricingSettings({ ensurePersisted: true });
  const contactUnlockPriceUsd = normalizeMoney(input?.contactUnlockPriceUsd, current.contactUnlockPriceUsd);
  const landlordListingPriceUsd = normalizeMoney(input?.landlordListingPriceUsd, current.landlordListingPriceUsd);
  const agentPriceDiscountPercent = normalizeMoney(
    input?.agentPriceDiscountPercent,
    current.agentPriceDiscountPercent,
  );

  const saved = await PricingSettings.findOneAndUpdate(
    { _id: "default" },
    {
      $set: {
        contactUnlockPriceUsd,
        landlordListingPriceUsd,
        agentPriceDiscountPercent,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean().exec();

  return {
    contactUnlockPriceUsd: normalizeMoney(
      saved?.contactUnlockPriceUsd,
      DEFAULT_PRICING_SETTINGS.contactUnlockPriceUsd,
    ),
    landlordListingPriceUsd: normalizeMoney(
      saved?.landlordListingPriceUsd,
      DEFAULT_PRICING_SETTINGS.landlordListingPriceUsd,
    ),
    agentPriceDiscountPercent: normalizeMoney(
      saved?.agentPriceDiscountPercent,
      DEFAULT_PRICING_SETTINGS.agentPriceDiscountPercent,
    ),
  };
}
