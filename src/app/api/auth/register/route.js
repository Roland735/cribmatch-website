import crypto from "crypto";
import { dbConnect, User } from "@/lib/db";

export const runtime = "nodejs";

function normalizePhoneNumber(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  let digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("2630")) digits = `263${digits.slice(4)}`;
  if (digits.startsWith("0") && digits.length === 10) {
    return `+263${digits.slice(1)}`;
  }
  if (digits.startsWith("7") && digits.length === 9) {
    return `+263${digits}`;
  }
  if (digits.startsWith("263")) return `+${digits}`;
  if (trimmed.startsWith("+")) return `+${digits}`;
  return digits;
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

function toRole(value) {
  return value === "admin" || value === "agent" || value === "user" ? value : "user";
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const phoneNumber = normalizePhoneNumber(body?.phoneNumber);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const password = body?.password;
  if (!phoneNumber) {
    return Response.json({ error: "Phone number is required" }, { status: 400 });
  }
  if (typeof password !== "string" || password.length < 8) {
    return Response.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 },
    );
  }

  const requestedRole = toRole(body?.role);
  const roleSecret = typeof body?.roleSecret === "string" ? body.roleSecret : "";
  const allowPrivileged = Boolean(process.env.AUTH_ROLE_SECRET);
  const role =
    requestedRole !== "user" && allowPrivileged && roleSecret === process.env.AUTH_ROLE_SECRET
      ? requestedRole
      : "user";

  await dbConnect();

  const existing = await User.findById(phoneNumber);
  if (existing) {
    return Response.json({ error: "Phone number already registered" }, { status: 409 });
  }

  const passwordRecord = await hashPassword(password);
  await User.create({
    _id: phoneNumber,
    name,
    password: passwordRecord,
    role,
  });

  return Response.json({ ok: true }, { status: 201 });
}
