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
  const exists = await Model.exists({ shortId: candidate }).lean().exec().catch(() => null);
  if (!exists) return candidate;
  return findUniqueShortId(Model, attemptsLeft - 1);
}

const ListingSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    listerPhoneNumber: { type: String, required: true, trim: true, index: true },
    shortId: { type: String, trim: true, uppercase: true },
    suburb: { type: String, required: true, trim: true },
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
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "published",
      index: true,
    },
  },
  { timestamps: true },
);

ListingSchema.index({ shortId: 1 }, { unique: true, sparse: true });

ListingSchema.pre("validate", async function ensureShortId(next) {
  try {
    if (this.shortId && typeof this.shortId === "string") {
      this.shortId = this.shortId.trim().toUpperCase();
      if (/^[A-Z0-9]{4}$/.test(this.shortId)) return next();
      this.shortId = undefined;
    }

    if (this.shortId) return next();

    const Model = this.constructor;
    this.shortId = await findUniqueShortId(Model, 20);
    return next();
  } catch (e) {
    return next(e);
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
  },
  { timestamps: true },
);

export const User = mongoose.models.User || mongoose.model("User", UserSchema);

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
