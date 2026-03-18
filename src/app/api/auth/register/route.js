import { dbConnect, User } from "@/lib/db";
import { hashPassword, normalizePhoneNumber } from "@/lib/auth";

export const runtime = "nodejs";

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
