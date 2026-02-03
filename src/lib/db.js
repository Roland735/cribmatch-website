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

const ListingSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    listerPhoneNumber: { type: String, required: true, trim: true, index: true },
    suburb: { type: String, required: true, trim: true },
    propertyCategory: {
      type: String,
      enum: ["residential", "commercial", "boarding", "land"],
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
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "published",
      index: true,
    },
  },
  { timestamps: true },
);

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
