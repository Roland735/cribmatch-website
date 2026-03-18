import { getServerSession } from "next-auth";
import { authOptions, hashPassword, verifyPassword } from "@/lib/auth";
import { dbConnect, User } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const phoneNumber =
    typeof session?.user?.phoneNumber === "string" ? session.user.phoneNumber.trim() : "";
  if (!phoneNumber) {
    return Response.json({ error: "Missing phone number" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

  if (newPassword.length < 8) {
    return Response.json({ error: "New password must be at least 8 characters" }, { status: 400 });
  }

  await dbConnect();
  const user = await User.findById(phoneNumber);
  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  const hasStoredPassword = Boolean(user?.password?.salt && user?.password?.hash);
  if (!hasStoredPassword) {
    return Response.json(
      { error: "No password set for this account. Use first web login setup." },
      { status: 400 },
    );
  }

  const isCurrentValid = await verifyPassword(currentPassword, user.password);
  if (!isCurrentValid) {
    return Response.json({ error: "Current password is incorrect" }, { status: 401 });
  }

  const nextPassword = await hashPassword(newPassword);
  user.password = nextPassword;
  await user.save();

  return Response.json({ ok: true });
}
