import crypto from "crypto";
import clientPromise from "@/lib/mongodb";

const GRAPH_VERSION = "v24.0";
const PRICE_TEXT = "US$1";
const MAX_ANSWER_LENGTH = 1800;
const STEPS = [
  ["fullName", "What is your full name as it should appear on your CV?"],
  ["targetRole", "What job title or kind of role are you applying for?"],
  ["email", "What email should employers use to contact you? Reply SKIP if you do not want it shown."],
  ["location", "What town or city are you based in? Reply SKIP to leave it off."],
  ["profile", "In a few sentences, tell me about your work background and what you are good at."],
  ["experience", "Share your most recent work experience: employer, job title, dates, and a few things you did. Reply SKIP if you have no work experience."],
  ["education", "Share your education or training: school/provider, qualification, and year. Reply SKIP if you prefer to leave it off."],
  ["skills", "List your main skills, separated by commas."],
];

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeZimbabwePhone(value) {
  const digits = digitsOnly(value);
  if (/^2637[1-8]\d{7}$/.test(digits)) return digits;
  if (/^07[1-8]\d{7}$/.test(digits)) return `263${digits.slice(1)}`;
  if (/^7[1-8]\d{7}$/.test(digits)) return `263${digits}`;
  return digits;
}

function matchesWebhookSignature(rawBody, signature, secret) {
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const suppliedBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  return suppliedBytes.length === expectedBytes.length && crypto.timingSafeEqual(suppliedBytes, expectedBytes);
}

export function isVerifiedWhatsAppWebhook(rawBody, signature) {
  const appSecret = process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET;
  return matchesWebhookSignature(rawBody, signature, appSecret);
}

export function hasIncomingWhatsAppMessages(payload) {
  return getIncomingMessages(payload).length > 0;
}

function getDatabase() {
  return clientPromise.then((client) => client.db());
}

async function graphRequest(path, init) {
  const token = process.env.WHATSAPP_API_TOKEN;
  if (!token) throw new Error("WHATSAPP_API_TOKEN is not configured");
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init?.headers },
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.error) {
    throw new Error(result?.error?.message || `WhatsApp API returned ${response.status}`);
  }
  return result;
}

async function sendText(to, body) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;
  if (!phoneNumberId) throw new Error("WHATSAPP_PHONE_NUMBER_ID is not configured");
  return graphRequest(`${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body } }),
  });
}

async function sendPdf(to, pdfBytes, filename, caption) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;
  if (!phoneNumberId) throw new Error("WHATSAPP_PHONE_NUMBER_ID is not configured");
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "application/pdf");
  form.append("file", new Blob([pdfBytes], { type: "application/pdf" }), filename);
  const media = await graphRequest(`${phoneNumberId}/media`, { method: "POST", body: form });
  return graphRequest(`${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "document",
      document: { id: media.id, filename, caption },
    }),
  });
}

function getIncomingMessages(payload) {
  const messages = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      for (const message of value.messages || []) {
        const text = message?.text?.body || message?.button?.text || message?.interactive?.button_reply?.title || message?.interactive?.list_reply?.title || "";
        messages.push({ id: String(message?.id || ""), from: digitsOnly(message?.from), text: String(text).trim() });
      }
    }
  }
  return messages.filter((message) => message.id && message.from);
}

function safeText(value) {
  return String(value || "").trim().slice(0, MAX_ANSWER_LENGTH);
}

function commandText(text) {
  return String(text || "").trim().toLowerCase();
}

function makeOrderCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

function promptFor(step) {
  return STEPS.find(([key]) => key === step)?.[1] || "Tell me a little more.";
}

function buildReview(data) {
  const line = (label, value) => value ? `*${label}:* ${value}` : "";
  return [
    "Here is the information for your CV:",
    line("Name", data.fullName),
    line("Applying for", data.targetRole),
    line("Email", data.email),
    line("Location", data.location),
    line("Profile", data.profile),
    line("Experience", data.experience),
    line("Education", data.education),
    line("Skills", data.skills),
    "",
    `The formatted PDF costs ${PRICE_TEXT}. Reply *YES* to place the order, *CHANGE skills* (or another field) to correct an answer, *EDIT* to start again, or *CANCEL* to stop.`,
  ].filter(Boolean).join("\n");
}

function pdfText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/[\\()]/g, "\\$&")
    .replace(/\s+/g, " ")
    .trim();
}

function wrap(value, maxChars) {
  const text = pdfText(value).replace(/\\([\\()])/g, "$1");
  if (!text) return [];
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function colorCommand(hex) {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((index) => (parseInt(value.slice(index, index + 2), 16) / 255).toFixed(3));
  return `${channels.join(" ")} rg`;
}

function buildCvPdf(data) {
  const pageOps = [[]];
  let pageIndex = 0;
  let y = 790;
  const ensureSpace = (height) => {
    if (y - height < 52) {
      pageOps.push([]);
      pageIndex += 1;
      y = 790;
    }
  };
  const draw = (text, { size = 10, font = "F1", color = "#24362d", x = 52, gap = 15 } = {}) => {
    ensureSpace(gap);
    const safe = pdfText(text);
    pageOps[pageIndex].push(`BT ${colorCommand(color)} /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${safe}) Tj ET`);
    y -= gap;
  };
  const paragraph = (text, { size = 10, color = "#37483f", maxChars = 92 } = {}) => {
    const lines = wrap(text, maxChars);
    for (const line of lines) draw(line, { size, color, gap: size + 5 });
    if (lines.length) y -= 4;
  };
  const section = (title) => {
    y -= 8;
    draw(title.toUpperCase(), { size: 10, font: "F2", color: "#0b7651", gap: 18 });
  };

  pageOps[0].push("0.043 0.463 0.318 rg 0 828 595 14 re f");
  draw(data.fullName || "Curriculum Vitae", { size: 25, font: "F2", color: "#10281d", gap: 32 });
  draw(data.targetRole || "Professional Profile", { size: 12, font: "F2", color: "#0b7651", gap: 19 });
  const contact = [data.email, data.location].filter(Boolean).join("  |  ");
  if (contact) draw(contact, { size: 9, color: "#617268", gap: 20 });
  section("Professional profile");
  paragraph(data.profile);
  if (data.experience && !/^skip$/i.test(data.experience)) {
    section("Experience");
    paragraph(data.experience);
  }
  if (data.education && !/^skip$/i.test(data.education)) {
    section("Education & training");
    paragraph(data.education);
  }
  if (data.skills) {
    section("Skills");
    paragraph(data.skills, { color: "#24362d" });
  }
  for (let index = 0; index < pageOps.length; index += 1) {
    pageOps[index].push(`BT ${colorCommand("#87948c")} /F1 8 Tf 1 0 0 1 52 32 Tm (Prepared with CribMatch CV) Tj ET`);
    pageOps[index].push(`BT ${colorCommand("#87948c")} /F1 8 Tf 1 0 0 1 530 32 Tm (${index + 1}) Tj ET`);
  }

  const regularFontId = 3 + pageOps.length * 2;
  const boldFontId = regularFontId + 1;
  const objects = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  const pageRefs = pageOps.map((_, index) => `${3 + index * 2} 0 R`).join(" ");
  objects[2] = `<< /Type /Pages /Kids [${pageRefs}] /Count ${pageOps.length} >>`;
  pageOps.forEach((operations, index) => {
    const pageId = 3 + index * 2;
    const contentId = pageId + 1;
    const stream = `${operations.join("\n")}\n`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}endstream`;
  });
  objects[regularFontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[boldFontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";

  let pdf = "%PDF-1.4\n% CribMatch CV\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(pdf, "ascii");
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "ascii");
}

async function notifyAdmin(message) {
  const adminPhone = normalizeZimbabwePhone(process.env.CV_ADMIN_PHONE);
  if (!adminPhone) return false;
  await sendText(adminPhone, message);
  return true;
}

async function startDraft(db, phone) {
  const now = new Date();
  const previous = await db.collection("cv_whatsapp_sessions").findOne({ _id: phone });
  if (previous?.orderCode) {
    await db.collection("cv_whatsapp_orders").deleteOne({ orderCode: previous.orderCode, status: "awaiting_payment" });
  }
  await db.collection("cv_whatsapp_sessions").updateOne(
    { _id: phone },
    { $set: { step: STEPS[0][0], data: {}, updatedAt: now, startedAt: now } },
    { upsert: true },
  );
  return sendText(phone, `Welcome to CribMatch CV. I’ll ask a few short questions and format your details into a professional PDF for ${PRICE_TEXT}. Your information is used to prepare your CV. Send DELETE at any time to remove your saved details.\n\n${promptFor(STEPS[0][0])}`);
}

async function processAdminCommand(db, phone, text) {
  const expectedAdmin = normalizeZimbabwePhone(process.env.CV_ADMIN_PHONE);
  if (!expectedAdmin || phone !== expectedAdmin) return false;
  const match = /^(APPROVE|REJECT)\s+([A-Z0-9]{6,10})$/i.exec(text.trim());
  if (!match) return false;
  const [, action, codeRaw] = match;
  const code = codeRaw.toUpperCase();
  const orders = db.collection("cv_whatsapp_orders");
  const order = await orders.findOne({ orderCode: code });
  if (!order) {
    await sendText(phone, `I couldn't find CV order ${code}.`);
    return true;
  }
  if (action.toUpperCase() === "REJECT") {
    await orders.updateOne({ _id: order._id }, { $set: { status: "payment_rejected", updatedAt: new Date() } });
    await sendText(order.phone, `Payment for CV order ${code} could not be confirmed yet. Please reply here if you need help.`);
    await sendText(phone, `Marked order ${code} as needing payment follow-up.`);
    return true;
  }
  if (order.status === "delivered") {
    await sendText(phone, `CV order ${code} has already been delivered.`);
    return true;
  }
  const pdfBytes = buildCvPdf(order.data);
  const filename = `${(order.data.fullName || "CribMatch-CV").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "CribMatch-CV"}.pdf`;
  await sendPdf(order.phone, pdfBytes, filename, `Your CV is ready. Thank you for using CribMatch. Order ${code}.`);
  await orders.updateOne({ _id: order._id }, { $set: { status: "delivered", updatedAt: new Date(), deliveredAt: new Date() } });
  await db.collection("cv_whatsapp_sessions").updateOne(
    { _id: order.phone, orderCode: code },
    { $set: { step: "delivered", updatedAt: new Date() } },
  );
  await sendText(phone, `Sent the PDF for CV order ${code}.`);
  return true;
}

async function handleIncomingMessage(db, { from, text }) {
  const normalized = commandText(text);
  if (!text) return;
  if (normalizeZimbabwePhone(process.env.CV_ADMIN_PHONE) === from && normalized === "admin") {
    await sendText(from, "Admin commands: APPROVE <order code> sends the paid CV PDF to its customer. REJECT <order code> asks the customer to follow up about payment. Keep this number private.");
    return;
  }
  if (await processAdminCommand(db, from, text)) return;

  const sessions = db.collection("cv_whatsapp_sessions");
  const orders = db.collection("cv_whatsapp_orders");
  if (normalized === "delete") {
    await sessions.deleteOne({ _id: from });
    await orders.deleteMany({ phone: from });
    await sendText(from, "Your saved CV details and orders have been deleted. Send START if you want to begin again.");
    return;
  }
  if (["start", "hi", "hello", "cv", "resume", "create cv", "create my cv"].includes(normalized)) {
    await startDraft(db, from);
    return;
  }
  if (["cancel", "stop"].includes(normalized)) {
    await sessions.deleteOne({ _id: from });
    await sendText(from, "Okay, I stopped the CV request. Send START whenever you want to begin again.");
    return;
  }

  const session = await sessions.findOne({ _id: from });
  if (!session) {
    await sendText(from, "Hi! I can help format a professional CV for US$1. Send START to begin.");
    return;
  }
  if (session.step === "awaiting_payment") {
    if (["edit", "restart"].includes(normalized)) {
      await startDraft(db, from);
      return;
    }
    if (normalized === "paid" || normalized.startsWith("paid ")) {
      const code = String(session.orderCode || "");
      await orders.updateOne({ orderCode: code }, { $set: { status: "payment_reported", updatedAt: new Date() } });
      const notified = await notifyAdmin(`CV payment reported. Order ${code}\nName: ${session.data?.fullName || ""}\nCustomer WhatsApp: +${from}\nReply APPROVE ${code} after confirming the US$1 payment.`).catch(() => false);
      await sendText(from, notified
        ? `Thanks. I’ve sent payment reference ${code} to our team for confirmation. I’ll deliver your PDF here once they approve it.`
        : `Thanks. Your CV order is ${code}. Our team still needs to confirm payment before the PDF can be sent.`);
      return;
    }
    await sendText(from, `Your CV order is ${session.orderCode}. The price is ${PRICE_TEXT}. ${process.env.CV_PAYMENT_INSTRUCTIONS || "Reply PAID after you have arranged payment with our team; the PDF is sent after payment is confirmed."}`);
    return;
  }
  if (session.step === "delivered") {
    await sendText(from, `Your CV order ${session.orderCode} has been delivered. Send START to create another CV, or DELETE to remove your saved details.`);
    return;
  }
  if (session.step === "review") {
    if (normalized.startsWith("change ")) {
      const requested = normalized.slice("change ".length).trim().replace(/[^a-z]/g, "");
      const aliases = {
        name: "fullName", fullname: "fullName", role: "targetRole", job: "targetRole", targetrole: "targetRole",
        email: "email", location: "location", city: "location", profile: "profile", summary: "profile",
        experience: "experience", work: "experience", education: "education", skills: "skills",
      };
      const field = aliases[requested];
      if (!field) {
        await sendText(from, "Choose a field to change: name, role, email, location, profile, experience, education, or skills. Example: CHANGE skills");
        return;
      }
      await sessions.updateOne({ _id: from }, { $set: { step: field, updatedAt: new Date() } });
      await sendText(from, promptFor(field));
      return;
    }
    if (["yes", "confirm", "order"].includes(normalized)) {
      const orderCode = makeOrderCode();
      const now = new Date();
      await orders.insertOne({ orderCode, phone: from, data: session.data || {}, status: "awaiting_payment", createdAt: now, updatedAt: now });
      await sessions.updateOne({ _id: from }, { $set: { step: "awaiting_payment", orderCode, updatedAt: now } });
      const instructions = process.env.CV_PAYMENT_INSTRUCTIONS || "Reply PAID after arranging payment with our team; the PDF will be sent here after payment is confirmed.";
      const notified = await notifyAdmin(`New CribMatch CV order ${orderCode}\nName: ${session.data?.fullName || ""}\nCustomer WhatsApp: +${from}\nPrice: US$1\n${instructions}\nReply APPROVE ${orderCode} after payment is confirmed.`).catch(() => false);
      await sendText(from, `Your order ${orderCode} is saved. The CV costs ${PRICE_TEXT}. ${instructions}${notified ? "\n\nI’ve notified our team. After they confirm payment, your PDF will arrive in this chat." : "\n\nOur team will confirm payment in this chat before sending the PDF."}`);
      return;
    }
    if (["edit", "restart"].includes(normalized)) {
      await startDraft(db, from);
      return;
    }
    await sendText(from, "Reply YES to place the $1 order, EDIT to enter your details again, or CANCEL to stop.");
    return;
  }

  const stepIndex = STEPS.findIndex(([key]) => key === session.step);
  if (stepIndex < 0) {
    await startDraft(db, from);
    return;
  }
  const [field] = STEPS[stepIndex];
  const answer = safeText(text);
  if (!answer) {
    await sendText(from, promptFor(field));
    return;
  }
  if (field === "fullName" && answer.length < 3) {
    await sendText(from, "Please send your first and last name.");
    return;
  }
  const value = normalized === "skip" ? "" : answer;
  const data = { ...(session.data || {}), [field]: value };
  const nextStep = STEPS[stepIndex + 1]?.[0];
  if (nextStep) {
    await sessions.updateOne({ _id: from }, { $set: { data, step: nextStep, updatedAt: new Date() } });
    await sendText(from, promptFor(nextStep));
    return;
  }
  await sessions.updateOne({ _id: from }, { $set: { data, step: "review", updatedAt: new Date() } });
  await sendText(from, buildReview(data));
}

export async function handleResumeWhatsAppWebhook(payload) {
  const messages = getIncomingMessages(payload);
  if (!messages.length) return { processed: 0 };
  const db = await getDatabase();
  const received = db.collection("cv_whatsapp_received_messages");
  await db.collection("cv_whatsapp_sessions").createIndex({ updatedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 }).catch(() => {});
  await db.collection("cv_whatsapp_orders").createIndex({ orderCode: 1 }, { unique: true }).catch(() => {});
  await db.collection("cv_whatsapp_orders").createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 }).catch(() => {});
  await received.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 }).catch(() => {});
  let processed = 0;
  for (const message of messages) {
    try {
      await received.insertOne({ _id: message.id, createdAt: new Date() });
    } catch (error) {
      if (error?.code === 11000) continue;
      throw error;
    }
    try {
      await handleIncomingMessage(db, message);
      processed += 1;
    } catch (error) {
      console.error("[cribmatch-cv-whatsapp] Message handling failed", error?.message || error);
      await sendText(message.from, "Sorry, I hit a problem saving that reply. Please send it again, or START to restart.").catch(() => {});
    }
  }
  return { processed };
}
