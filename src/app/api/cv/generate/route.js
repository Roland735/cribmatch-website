import crypto from "node:crypto";
import clientPromise from "@/lib/mongodb";
import { buildCvPdf } from "@/lib/whatsappResumeBuilder";
import { cleanCandidateFacts, normalizeCandidatePhone, writeCandidateCv } from "@/lib/cvWriting";

export const runtime = "nodejs";

export async function POST(request) {
  let jobId = "";
  try {
    const body = await request.json();
    const facts = cleanCandidateFacts(body?.facts);
    if (!facts.candidate.fullName || !facts.candidate.phone || !facts.goal.targetRole) {
      return Response.json({ error: "Full name, phone number, and target job are required." }, { status: 400 });
    }
    if (facts.candidate.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(facts.candidate.email)) {
      return Response.json({ error: "Enter a valid email address or leave it blank." }, { status: 400 });
    }
    const client = await clientPromise;
    const db = client.db();
    const idempotencyKey = String(body?.requestId || crypto.randomUUID()).slice(0, 100);
    const jobs = db.collection("cv_generation_jobs");
    await jobs.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 }).catch(() => {});
    await jobs.createIndex({ idempotencyKey: 1 }, { unique: true }).catch(() => {});
    await Promise.all(["cv_candidate_facts", "cv_writing_preferences", "cv_generated_wording", "cv_versions"].map((name) => db.collection(name).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {})));
    const existing = await jobs.findOne({ idempotencyKey });
    if (existing?.status === "completed" && existing.versionId) return Response.json({ id: existing.versionId, key: existing.accessKey, reused: true });
    if (existing?.status === "processing") return Response.json({ error: "This draft is already being prepared. Please wait a moment." }, { status: 409 });
    const id = crypto.randomUUID();
    const accessKey = crypto.randomBytes(32).toString("base64url");
    const now = new Date();
    jobId = idempotencyKey;
    await jobs.updateOne({ idempotencyKey }, { $setOnInsert: { idempotencyKey, createdAt: now }, $set: { status: "processing", versionId: id, accessKey, updatedAt: now } }, { upsert: true });

    const candidateRecordId = crypto.randomUUID();
    const factsCollection = db.collection("cv_candidate_facts");
    const writingCollection = db.collection("cv_writing_preferences");
    const generatedCollection = db.collection("cv_generated_wording");
    const versions = db.collection("cv_versions");
    const factsDoc = { _id: candidateRecordId, versionId: id, candidatePhoneDigits: normalizeCandidatePhone(facts.candidate.phone), facts, createdAt: now, expiresAt: new Date(now.getTime() + 30 * 86400000) };
    await factsCollection.insertOne(factsDoc);
    await writingCollection.insertOne({ _id: id, candidateRecordId, preferences: facts.writingPreferences, createdAt: now, expiresAt: factsDoc.expiresAt });
    const wording = await writeCandidateCv(facts);
    await generatedCollection.insertOne({ _id: id, candidateRecordId, wording: { objective: wording.objective, profile: wording.profile, achievements: wording.achievements }, provider: facts.writingPreferences.aiConsent && process.env.GEMINI_API_KEY ? "gemini-or-template-fallback" : "template", createdAt: new Date(), expiresAt: factsDoc.expiresAt });
    const pdf = buildCvPdf(wording);
    await versions.insertOne({ _id: id, candidateRecordId, status: "draft", accessKey, pdf, filename: `${facts.candidate.fullName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "CribMatch-CV"}.pdf`, createdAt: now, expiresAt: factsDoc.expiresAt });
    await jobs.updateOne({ idempotencyKey }, { $set: { status: "completed", versionId: id, accessKey, updatedAt: new Date(), completedAt: new Date() } });
    return Response.json({ id, key: accessKey });
  } catch (error) {
    console.error("[cv-builder] CV draft creation failed", error?.message || error);
    if (jobId) {
      try {
        const client = await clientPromise;
        const db = client.db();
        const job = await db.collection("cv_generation_jobs").findOne({ idempotencyKey: jobId });
        if (job?.versionId) await Promise.all([db.collection("cv_candidate_facts").deleteOne({ versionId: job.versionId }), db.collection("cv_writing_preferences").deleteOne({ _id: job.versionId }), db.collection("cv_generated_wording").deleteOne({ _id: job.versionId }), db.collection("cv_versions").deleteOne({ _id: job.versionId })]);
        await db.collection("cv_generation_jobs").updateOne({ idempotencyKey: jobId }, { $set: { status: "failed", error: "generation_failed", updatedAt: new Date() } });
      } catch {}
    }
    return Response.json({ error: "We could not create the draft just now. Your details are still in this form; please try again." }, { status: 500 });
  }
}
