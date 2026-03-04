import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbConnect, User } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const phoneNumber = typeof session?.user?.phoneNumber === "string" ? session.user.phoneNumber.trim() : "";
  if (!phoneNumber) {
    return Response.json({ error: "Missing phone number" }, { status: 400 });
  }

  try {
    await dbConnect();
    const user = await User.findById(phoneNumber).lean();
    if (!user) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    return Response.json({
      user: {
        phoneNumber: user._id,
        name: user.name || "",
        role: user.role
      }
    });
  } catch (error) {
    console.error("API Profile GET Error:", error);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const phoneNumber = typeof session?.user?.phoneNumber === "string" ? session.user.phoneNumber.trim() : "";
  if (!phoneNumber) {
    return Response.json({ error: "Missing phone number" }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { name } = body;

    await dbConnect();
    const user = await User.findByIdAndUpdate(
      phoneNumber,
      { $set: { name: name?.trim() || "" } },
      { new: true }
    ).lean();

    if (!user) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    return Response.json({
      user: {
        phoneNumber: user._id,
        name: user.name || "",
        role: user.role
      }
    });
  } catch (error) {
    console.error("API Profile PATCH Error:", error);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
