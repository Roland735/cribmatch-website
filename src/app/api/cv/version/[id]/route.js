import crypto from "node:crypto";
import clientPromise from "@/lib/mongodb";

export const runtime = "nodejs";

function keyMatches(stored, supplied) {
  if (typeof stored !== "string" || typeof supplied !== "string") return false;
  const left = Buffer.from(stored);
  const right = Buffer.from(supplied);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export async function GET(request, { params }) {
  const { id } = await params;
  const supplied = new URL(request.url).searchParams.get("key") || "";
  const client = await clientPromise;
  const version = await client.db().collection("cv_versions").findOne({ _id: id });
  if (!version || !keyMatches(version.accessKey, supplied)) return new Response("CV not found", { status: 404 });
  return new Response(version.pdf.buffer.slice(version.pdf.byteOffset, version.pdf.byteOffset + version.pdf.byteLength), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${String(version.filename).replace(/[\r\n"\\]/g, "_")}"`, "Cache-Control": "private, no-store" },
  });
}

export async function POST(request, { params }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  if (body.action !== "approve") return Response.json({ error: "Unsupported action" }, { status: 400 });
  const client = await clientPromise;
  const db = client.db();
  const versions = db.collection("cv_versions");
  const version = await versions.findOne({ _id: id });
  if (!version || !keyMatches(version.accessKey, body.key)) return Response.json({ error: "CV not found" }, { status: 404 });
  await versions.updateOne({ _id: id, status: "draft" }, { $set: { status: "approved", approvedAt: new Date() } });
  return Response.json({ ok: true });
}

export async function DELETE(request, { params }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const client = await clientPromise;
  const db = client.db();
  const version = await db.collection("cv_versions").findOne({ _id: id });
  if (!version || !keyMatches(version.accessKey, body.key)) return Response.json({ error: "CV not found" }, { status: 404 });
  await Promise.all([
    db.collection("cv_candidate_facts").deleteOne({ versionId: id }),
    db.collection("cv_writing_preferences").deleteOne({ _id: id }),
    db.collection("cv_generated_wording").deleteOne({ _id: id }),
    db.collection("cv_generation_jobs").updateMany({ versionId: id, status: { $in: ["queued", "processing"] } }, { $set: { status: "cancelled", updatedAt: new Date() } }),
    db.collection("cv_versions").deleteOne({ _id: id }),
  ]);
  return Response.json({ ok: true });
}
