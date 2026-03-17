import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

function sanitizeFilename(value) {
  if (typeof value !== "string") return "photo";
  const cleaned = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
  return cleaned ? cleaned.slice(-100) : "photo";
}

function guessExtension(file) {
  const byName = typeof file?.name === "string" ? file.name.split(".").pop()?.toLowerCase() : "";
  if (byName) return byName.replace(/[^a-z0-9]/g, "") || "jpg";
  const byType = typeof file?.type === "string" ? file.type.split("/").pop()?.toLowerCase() : "";
  if (byType) return byType.replace(/[^a-z0-9]/g, "") || "jpg";
  return "jpg";
}

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json(
      { error: "Image upload is not configured on the server" },
      { status: 503 },
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Image file is required" }, { status: 400 });
  }
  if (!String(file.type || "").startsWith("image/")) {
    return Response.json({ error: "Only image files are allowed" }, { status: 400 });
  }
  if (file.size <= 0 || file.size > 20 * 1024 * 1024) {
    return Response.json({ error: "Image must be between 1 byte and 20MB" }, { status: 400 });
  }

  const extension = guessExtension(file);
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  const safeName = sanitizeFilename(file.name || `photo.${extension}`);
  const path = `${new Date().toISOString().slice(0, 10)}/${id}-${safeName}`;

  const buffer = await file.arrayBuffer();
  const { error: uploadError } = await supabaseAdmin.storage
    .from("listings")
    .upload(path, buffer, {
      contentType: file.type || "image/jpeg",
      upsert: true,
    });

  if (uploadError) {
    return Response.json(
      { error: uploadError.message || "Failed to upload image" },
      { status: 500 },
    );
  }

  const { data } = supabaseAdmin.storage.from("listings").getPublicUrl(path);
  return Response.json({ url: data?.publicUrl || "" });
}
