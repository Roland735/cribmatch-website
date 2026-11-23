import crypto from "crypto";
import clientPromise from "@/lib/mongodb";

const GRAPH_VERSION = "v24.0";
const MAX_ANSWER_LENGTH = 1800;
const FLOW_NAME = "CribMatch Full CV Builder";
let cachedFlowId = null;
const CV_SECTIONS = [
  {
    id: "CONTACT",
    title: "Contact details",
    fields: [
      { name: "fullName", label: "Full name", required: true, maxChars: 80 },
      { name: "targetRole", label: "Target job title", required: true, maxChars: 80 },
      { name: "email", label: "Email address", inputType: "email", maxChars: 100 },
      { name: "phone", label: "Phone number", inputType: "phone", maxChars: 32 },
      { name: "location", label: "Town or city", maxChars: 80 },
      { name: "links", label: "LinkedIn or website", maxChars: 180 },
    ],
  },
  {
    id: "PROFILE",
    title: "Profile and focus",
    fields: [
      { name: "profile", label: "Professional profile", type: "TextArea", required: true, maxLength: 600, helperText: "Summarise your experience and strengths." },
      { name: "objective", label: "Career objective", type: "TextArea", maxLength: 300, helperText: "Optional: the roles or goals you are targeting." },
      { name: "expertise", label: "Core expertise", type: "TextArea", maxLength: 500, helperText: "Optional: group your strongest areas." },
    ],
  },
  {
    id: "EXPERIENCE",
    title: "Work experience",
    fields: [
      { name: "experience", label: "Roles and employers", type: "TextArea", maxLength: 600, helperText: "List each role, employer, and dates. Leave blank if none." },
      { name: "achievements", label: "Duties and results", type: "TextArea", maxLength: 600, helperText: "Add key duties, achievements, and measurable results." },
    ],
  },
  {
    id: "EDUCATION",
    title: "Education",
    fields: [
      { name: "education", label: "Education history", type: "TextArea", maxLength: 600, helperText: "Qualification, institution, dates, subjects, and results." },
      { name: "certifications", label: "Certificates", type: "TextArea", maxLength: 400, helperText: "Optional: certificates, training, and professional memberships." },
    ],
  },
  {
    id: "SKILLS",
    title: "Skills and tools",
    fields: [
      { name: "skills", label: "Core skills", type: "TextArea", maxLength: 500, helperText: "List role-related skills and strengths." },
      { name: "technologies", label: "Tools and technology", type: "TextArea", maxLength: 400, helperText: "Optional: software, platforms, equipment, or methods." },
      { name: "languages", label: "Languages", type: "TextArea", maxLength: 200, helperText: "Optional: languages and proficiency." },
    ],
  },
  {
    id: "PROJECTS",
    title: "Projects",
    fields: [
      { name: "projects", label: "Selected projects", type: "TextArea", maxLength: 600, helperText: "Optional: name, purpose, contribution, and technologies." },
    ],
  },
  {
    id: "EXTRA",
    title: "Additional details",
    terminal: true,
    fields: [
      { name: "awards", label: "Awards and honours", type: "TextArea", maxLength: 300, helperText: "Optional: awards, publications, or notable recognition." },
      { name: "volunteering", label: "Community work", type: "TextArea", maxLength: 300, helperText: "Optional: volunteering, leadership, or community work." },
      { name: "references", label: "References", type: "TextArea", maxLength: 300, helperText: "Optional: names and contact details, or write 'Available on request'." },
    ],
  },
];

function makeFlowInput(field) {
  if (field.type === "TextArea") {
    return {
      type: "TextArea",
      name: field.name,
      label: field.label,
      ...(field.required ? { required: true } : {}),
      "max-length": field.maxLength || 600,
      ...(field.helperText ? { "helper-text": field.helperText } : {}),
    };
  }
  return {
    type: "TextInput",
    name: field.name,
    label: field.label,
    ...(field.required ? { required: true } : {}),
    ...(field.inputType ? { "input-type": field.inputType } : {}),
    "max-chars": field.maxChars || 80,
  };
}

function flowDataModel(fields) {
  return Object.fromEntries(fields.map((field) => [field.name, { type: "string", __example__: "Example" }]));
}

function makeFlowScreen(section, index) {
  const previousFields = CV_SECTIONS.slice(0, index).flatMap((item) => item.fields);
  const allAvailableFields = [...previousFields, ...section.fields];
  const nextSection = CV_SECTIONS[index + 1];
  const payload = Object.fromEntries(allAvailableFields.map((field) => [
    field.name,
    previousFields.includes(field) ? `\${data.${field.name}}` : `\${form.${field.name}}`,
  ]));
  const action = section.terminal
    ? { name: "complete", payload }
    : { name: "navigate", next: { type: "screen", name: nextSection.id }, payload };

  return {
    id: section.id,
    title: section.title,
    ...(section.terminal ? { terminal: true, success: true } : {}),
    data: flowDataModel(previousFields),
    layout: {
      type: "SingleColumnLayout",
      children: [{
        type: "Form",
        name: `${section.id.toLowerCase()}_form`,
        children: [
          { type: "TextSubheading", text: section.title },
          ...section.fields.map(makeFlowInput),
          { type: "Footer", label: section.terminal ? "Create my CV" : "Continue", "on-click-action": action },
        ],
      }],
    },
  };
}

const FLOW_JSON = {
  version: "7.3",
  routing_model: Object.fromEntries(CV_SECTIONS.map((section, index) => [
    section.id,
    section.terminal ? [] : [CV_SECTIONS[index + 1].id],
  ])),
  screens: CV_SECTIONS.map(makeFlowScreen),
};

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
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

async function getOrCreateFlow() {
  if (cachedFlowId) return cachedFlowId;
  const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  if (!wabaId) throw new Error("WHATSAPP_BUSINESS_ACCOUNT_ID is not configured");
  const query = new URLSearchParams({ fields: "id,name,status", limit: "100" });
  const existing = await graphRequest(`${wabaId}/flows?${query.toString()}`, { method: "GET" });
  const matching = (existing.data || []).find((flow) => flow.name === FLOW_NAME && flow.status === "PUBLISHED");
  if (matching?.id) {
    cachedFlowId = String(matching.id);
    return cachedFlowId;
  }

  const form = new FormData();
  form.append("name", FLOW_NAME);
  form.append("categories", JSON.stringify(["OTHER"]));
  form.append("flow_json", JSON.stringify(FLOW_JSON));
  form.append("publish", "true");
  const created = await graphRequest(`${wabaId}/flows`, { method: "POST", body: form });
  if (!created.id) throw new Error("Meta did not return a WhatsApp Flow ID");
  cachedFlowId = String(created.id);
  return cachedFlowId;
}

async function sendCvFlow(to) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;
  if (!phoneNumberId) throw new Error("WHATSAPP_PHONE_NUMBER_ID is not configured");
  const flowId = await getOrCreateFlow();
  return graphRequest(`${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "interactive",
      interactive: {
        type: "flow",
        body: { text: "Fill in your details in this WhatsApp form. When you submit it, CribMatch will create a test CV PDF and send it here." },
        action: { name: "flow", parameters: { flow_message_version: "3", flow_id: flowId, flow_cta: "Build my CV", flow_action: "navigate", flow_action_payload: { screen: "CONTACT" } } },
      },
    }),
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
        const flowReply = message?.interactive?.nfm_reply?.response_json;
        const text = message?.text?.body || message?.button?.text || message?.interactive?.button_reply?.title || message?.interactive?.list_reply?.title || "";
        messages.push({ id: String(message?.id || ""), from: digitsOnly(message?.from), text: String(text).trim(), flowReply });
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
  const contact = [data.email, data.phone, data.location].filter(Boolean).join("  |  ");
  if (contact) paragraph(contact, { size: 9, color: "#617268", maxChars: 88 });
  if (data.links) paragraph(data.links, { size: 9, color: "#617268", maxChars: 88 });
  section("Professional profile");
  paragraph(data.profile);
  if (data.objective) {
    section("Career objective");
    paragraph(data.objective);
  }
  if (data.expertise) {
    section("Core expertise");
    paragraph(data.expertise);
  }
  if (data.experience || data.achievements) {
    section("Experience");
    paragraph(data.experience);
    paragraph(data.achievements);
  }
  if (data.education && !/^skip$/i.test(data.education)) {
    section("Education");
    paragraph(data.education);
  }
  if (data.certifications) {
    section("Certifications & training");
    paragraph(data.certifications);
  }
  if (data.skills || data.technologies || data.languages) {
    section("Skills and tools");
    paragraph(data.skills, { color: "#24362d" });
    if (data.technologies) paragraph(`Tools and technology: ${data.technologies}`);
    if (data.languages) paragraph(`Languages: ${data.languages}`);
  }
  if (data.projects) {
    section("Selected projects");
    paragraph(data.projects);
  }
  if (data.awards || data.volunteering || data.references) {
    section("Additional details");
    if (data.awards) paragraph(`Awards and honours: ${data.awards}`);
    if (data.volunteering) paragraph(`Community work: ${data.volunteering}`);
    if (data.references) paragraph(`References: ${data.references}`);
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

async function startDraft(phone) {
  await sendCvFlow(phone);
}

function cleanFlowData(flowReply, senderPhone) {
  let parsed = flowReply;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { return null; }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const fields = [
    "fullName", "targetRole", "email", "phone", "location", "links", "profile", "objective", "expertise",
    "experience", "achievements", "education", "certifications", "skills", "technologies", "languages",
    "projects", "awards", "volunteering", "references",
  ];
  const data = {};
  for (const field of fields) data[field] = safeText(parsed[field]);
  if (!data.phone) data.phone = safeText(senderPhone);
  if (data.fullName.length < 3 || !data.targetRole || !data.profile) return null;
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return null;
  return data;
}

async function handleIncomingMessage(db, { from, text, flowReply }) {
  const normalized = commandText(text);
  if (flowReply) {
    const data = cleanFlowData(flowReply, from);
    if (!data) {
      await sendText(from, "I couldn't read all the required fields. Send START to reopen the CV form and submit it again.");
      return;
    }
    const now = new Date();
    await db.collection("cv_whatsapp_submissions").insertOne({ phone: from, data, createdAt: now, updatedAt: now });
    const filename = `${data.fullName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "CribMatch-CV"}.pdf`;
    await sendPdf(from, buildCvPdf(data), filename, "Your CribMatch CV test PDF is ready.");
    await sendText(from, "Your CV test PDF is attached. No payment is enabled yet. Send START to make another test CV, or DELETE to remove your saved test data.");
    return;
  }
  if (["delete", "delete my data"].includes(normalized)) {
    await db.collection("cv_whatsapp_submissions").deleteMany({ phone: from });
    await db.collection("cv_whatsapp_sessions").deleteOne({ _id: from });
    await db.collection("cv_whatsapp_orders").deleteMany({ phone: from });
    await sendText(from, "Your saved test CV details have been deleted. Send START to open the CV form again.");
    return;
  }
  if (["start", "hi", "hello", "cv", "resume", "create cv", "create my cv"].includes(normalized)) {
    await startDraft(from);
    return;
  }
  await sendText(from, "CribMatch CV is in testing. Send START to open the CV form.");
}

export async function handleResumeWhatsAppWebhook(payload) {
  const messages = getIncomingMessages(payload);
  if (!messages.length) return { processed: 0 };
  const db = await getDatabase();
  const received = db.collection("cv_whatsapp_received_messages");
  await db.collection("cv_whatsapp_submissions").createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 }).catch(() => {});
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
      console.error("[cribmatch-cv-whatsapp] Flow handling failed", error?.message || error);
      await sendText(message.from, "I couldn't complete that step. Send START to reopen the CV form.").catch(() => {});
    }
  }
  return { processed };
}
