import crypto from "crypto";
import clientPromise from "@/lib/mongodb";
import { cleanCandidateFacts, normalizeCandidatePhone, writeCandidateCv } from "@/lib/cvWriting";

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
      { name: "dateOfBirth", label: "Date of birth", type: "DatePicker", helperText: "Only include this if relevant to your CV." },
      { name: "idNumber", label: "National ID or passport", maxChars: 40, helperText: "Only enter this if you want it shown on your CV." },
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
      { type: "RepeatableGroup", name: "expertise", addLabel: "area of expertise", maxEntries: 4, entries: [
        [{ name: "expertise", label: "Area of expertise", maxLength: 120, helperText: "Enter one area at a time." }],
      ] },
    ],
  },
  {
    id: "EXPERIENCE",
    title: "Work experience",
    fields: [
      { type: "RepeatableGroup", name: "experience", addLabel: "role", maxEntries: 3, entries: [
        [
          { name: "experience", label: "Role title, employer, and dates", maxLength: 400, helperText: "Start with your most recent role." },
          { name: "achievements", label: "Duties and results", maxLength: 400, helperText: "Add key duties, achievements, and measurable results." },
        ],
      ] },
    ],
  },
  {
    id: "EDUCATION",
    title: "Education",
    fields: [
      { type: "RepeatableGroup", name: "education", addLabel: "education entry", maxEntries: 3, entries: [
        [{ name: "education", label: "Qualification, institution, dates, subjects, and results", maxLength: 400 }],
      ] },
      { type: "RepeatableGroup", name: "certifications", addLabel: "certificate", maxEntries: 3, entries: [
        [{ name: "certifications", label: "Certificate, training, or professional membership", maxLength: 300 }],
      ] },
    ],
  },
  {
    id: "SKILLS",
    title: "Skills and tools",
    fields: [
      { type: "RepeatableGroup", name: "skills", addLabel: "skill", maxEntries: 3, entries: [
        [{ name: "skills", label: "Skill", maxLength: 120, helperText: "Enter one skill at a time." }],
      ] },
      { type: "RepeatableGroup", name: "technologies", addLabel: "tool or technology", maxEntries: 2, entries: [
        [{ name: "technologies", label: "Tool or technology", maxLength: 120, helperText: "Enter one tool, platform, or method at a time." }],
      ] },
      { type: "RepeatableGroup", name: "languages", addLabel: "language", maxEntries: 3, entries: [
        [{ name: "languages", label: "Language and proficiency", maxLength: 120, helperText: "Enter one language and proficiency at a time." }],
      ] },
    ],
  },
  {
    id: "PROJECTS",
    title: "Projects",
    fields: [
      { type: "RepeatableGroup", name: "projects", addLabel: "project", maxEntries: 3, entries: [
        [{ name: "projects", label: "Project name, purpose, contribution, and technologies", maxLength: 350, helperText: "Add one project at a time." }],
      ] },
    ],
  },
  {
    id: "EXTRA",
    title: "Additional details",
    terminal: true,
    fields: [
      { type: "RepeatableGroup", name: "awards", addLabel: "award or honour", maxEntries: 3, entries: [
        [{ name: "awards", label: "Award, publication, or recognition", maxLength: 250 }],
      ] },
      { type: "RepeatableGroup", name: "volunteering", addLabel: "community role", maxEntries: 2, entries: [
        [{ name: "volunteering", label: "Volunteering or community role", maxLength: 250 }],
      ] },
      { type: "RepeatableGroup", name: "references", addLabel: "reference", maxEntries: 3, entries: [
        [{ name: "references", label: "Reference name and contact details", maxLength: 250, helperText: "You can also enter 'Available on request'." }],
      ] },
    ],
  },
];

function makeFlowInput(field) {
  if (field.type === "DatePicker") {
    return {
      type: "DatePicker",
      name: field.name,
      label: field.label,
      ...(field.required ? { required: true } : {}),
      ...(field.helperText ? { "helper-text": field.helperText } : {}),
    };
  }
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
    ...(field.helperText ? { "helper-text": field.helperText } : {}),
  };
}

function repeatableEntries(field) {
  return Array.from({ length: field.maxEntries }, () => field.entries[0]);
}

function flowDataModel(fields) {
  return Object.fromEntries(fields.flatMap((field) => (
    field.type === "RepeatableGroup"
      ? [
          ...repeatableEntries(field).flatMap((entry, index) => entry.map((item) => [`${item.name}_${index + 1}`, { type: "string", __example__: "Example" }])),
          ...repeatableEntries(field).slice(1).map((_, index) => [`add_${field.name}_${index + 2}`, { type: "boolean", __example__: false }]),
        ]
      : [[field.name, { type: field.type === "OptIn" ? "boolean" : "string", __example__: field.type === "OptIn" ? false : "Example" }]]
  )));
}

function makeRepeatableGroup(field) {
  const entries = repeatableEntries(field);
  const makeEntry = (index) => {
    const entry = entries[index];
    const children = entry.map((item) => makeFlowInput({ ...item, name: `${item.name}_${index + 1}`, type: "TextArea" }));
    if (index < entries.length - 1) {
      const nextIndex = index + 1;
      const addField = `add_${field.name}_${nextIndex + 1}`;
      children.push({ type: "OptIn", name: addField, label: `＋ Add another ${field.addLabel}` });
      children.push({
        type: "If",
        condition: `\${form.${addField}} == true`,
        then: makeEntry(nextIndex),
      });
    }
    return children;
  };
  return makeEntry(0);
}

function sectionFields(fields) {
  return fields.flatMap((field) => (
    field.type === "RepeatableGroup"
      ? repeatableEntries(field).flatMap((entry, index) => entry.map((item) => ({ ...item, name: `${item.name}_${index + 1}`, type: "TextArea" })))
        .concat(repeatableEntries(field).slice(1).map((_, index) => ({ name: `add_${field.name}_${index + 2}`, type: "OptIn" })))
      : [field]
  ));
}

function makeFlowScreen(section, index) {
  const previousFields = CV_SECTIONS.slice(0, index).flatMap((item) => sectionFields(item.fields));
  const currentFields = sectionFields(section.fields);
  const allAvailableFields = [...previousFields, ...currentFields];
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
          ...section.fields.flatMap((field) => field.type === "RepeatableGroup" ? makeRepeatableGroup(field) : [makeFlowInput(field)]),
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

async function sendActionButtons(to, body, buttons) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;
  if (!phoneNumberId) throw new Error("WHATSAPP_PHONE_NUMBER_ID is not configured");
  return graphRequest(`${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: body },
        action: { buttons: buttons.map(({ id, title }) => ({ type: "reply", reply: { id, title } })) },
      },
    }),
  });
}

async function getOrCreateFlow() {
  if (cachedFlowId) return cachedFlowId;
  const configuredFlowId = String(process.env.WHATSAPP_CV_FLOW_ID || "").trim();
  if (configuredFlowId) {
    cachedFlowId = configuredFlowId;
    return cachedFlowId;
  }
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
        action: { name: "flow", parameters: { flow_message_version: "3", flow_id: flowId, flow_cta: "Build my CV", flow_action: "navigate", flow_action_payload: { screen: process.env.WHATSAPP_CV_FLOW_ID ? "GOAL" : "CONTACT" } } },
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
        const text = message?.text?.body || message?.button?.text || message?.interactive?.button_reply?.id || message?.interactive?.button_reply?.title || message?.interactive?.list_reply?.id || message?.interactive?.list_reply?.title || "";
        messages.push({ id: String(message?.id || ""), from: digitsOnly(message?.from), text: String(text).trim(), flowReply });
      }
    }
  }
  return messages.filter((message) => message.id && message.from);
}

function safeText(value) {
  return String(value || "").trim().slice(0, MAX_ANSWER_LENGTH);
}

function safeFlowDate(value) {
  const raw = safeText(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(raw);
  if (!match) return "";
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== `${year}-${month}-${day}`
    ? ""
    : `${year}-${month}-${day}`;
}

function commandText(text) {
  return String(text || "").trim().toLowerCase();
}

const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

function pdfPlainText(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E\n]/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .trim();
}

function pdfText(value) {
  return pdfPlainText(value).replace(/[\\()]/g, "\\$&");
}

function pdfTextWidth(value, size) {
  return [...String(value || "")].reduce((width, character) => {
    const code = character.charCodeAt(0);
    return width + (HELVETICA_WIDTHS[code - 32] || 556) * size / 1000;
  }, 0);
}

function splitWideWord(word, maxWidth, size) {
  const pieces = [];
  let piece = "";
  for (const character of word) {
    const candidate = piece + character;
    if (piece && pdfTextWidth(candidate, size) > maxWidth) {
      pieces.push(piece);
      piece = character;
    } else {
      piece = candidate;
    }
  }
  if (piece) pieces.push(piece);
  return pieces;
}

function wrapPdfText(value, maxWidth, size) {
  const paragraphs = pdfPlainText(value).split("\n");
  const lines = [];
  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const originalWord of paragraph.split(/\s+/)) {
      const words = pdfTextWidth(originalWord, size) > maxWidth
        ? splitWideWord(originalWord, maxWidth, size)
        : [originalWord];
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && pdfTextWidth(candidate, size) > maxWidth) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function colorCommand(hex) {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((index) => (parseInt(value.slice(index, index + 2), 16) / 255).toFixed(3));
  return `${channels.join(" ")} rg`;
}

async function polishResumeWithGemini(data) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || process.env.GEMINI_CV_POLISH_ENABLED === "false") return data;

  const primaryModel = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
  const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite";
  const models = [...new Set([primaryModel, fallbackModel])];
  const redactIdentifiers = (value) => String(value || "")
    .replace(/\b\d{2}-\d{6,7}[A-Z]\d{2}\b/gi, "[redacted identifier]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted email]")
    .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, "[redacted phone]");
  const source = {
    targetRole: data.targetRole,
    profile: data.profile,
    objective: data.objective,
    expertise: data.expertise,
    experience: data.experience,
    achievements: data.achievements,
    education: data.education,
    certifications: data.certifications,
    skills: data.skills,
    technologies: data.technologies,
    languages: data.languages,
    projects: data.projects,
    awards: data.awards,
    volunteering: data.volunteering,
  };
  for (const [key, value] of Object.entries(source)) {
    source[key] = Array.isArray(value) ? value.map(redactIdentifiers) : redactIdentifiers(value);
  }
  const prompt = [
    "Improve the wording of this CV for the stated target role. Return only a JSON object with string fields profile, objective, and achievements.",
    "Keep every claim grounded in the supplied text. Do not invent employers, dates, qualifications, metrics, duties, or skills. Preserve the meaning and scale of each achievement. Keep fields empty when the source is empty. Use clear, professional Zimbabwean/British English. Keep the profile concise (up to 100 words), objective up to 60 words, and achievements as concise bullet lines.",
    "Do not include or infer personal contact details or identity information.",
    JSON.stringify(source),
  ].join("\n\n");

  for (const model of models) {
    try {
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({ model, input: prompt, store: false }),
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) {
        console.error("[cribmatch-cv-whatsapp] Gemini CV polish failed", model, response.status);
        if (response.status === 401 || response.status === 403) break;
        continue;
      }
      const result = await response.json();
      const output = typeof result?.output_text === "string"
        ? result.output_text
        : (result?.steps || [])
          .filter((step) => step?.type === "model_output")
          .flatMap((step) => step.content || [])
          .filter((part) => part?.type === "text" && typeof part.text === "string")
          .map((part) => part.text)
          .join("\n");
      if (!output.trim()) continue;
      const parsed = JSON.parse(output.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
      return {
        ...data,
        profile: typeof parsed.profile === "string" && parsed.profile.trim() ? parsed.profile.trim() : data.profile,
        objective: typeof parsed.objective === "string" ? parsed.objective.trim() : data.objective,
        achievements: typeof parsed.achievements === "string" && parsed.achievements.trim() ? parsed.achievements.trim() : data.achievements,
      };
    } catch (error) {
      console.error("[cribmatch-cv-whatsapp] Gemini CV polish unavailable", model, error?.message || error);
    }
  }
  return data;
}

export function buildCvPdf(data) {
  const pageWidth = 595;
  const pageHeight = 842;
  const left = 52;
  const right = 543;
  const contentWidth = right - left;
  const footerLimit = 54;
  const lineHeight = (size) => size * 1.42;
  const pageOps = [[]];
  let pageIndex = 0;
  let y = 790;
  const pushText = (text, { size = 10, font = "F1", color = "#24362d", x = left, baseline = y } = {}) => {
    pageOps[pageIndex].push(`BT ${colorCommand(color)} /${font} ${size} Tf 1 0 0 1 ${x} ${baseline} Tm (${pdfText(text)}) Tj ET`);
  };
  const addPage = () => {
    pageOps.push(["0.043 0.463 0.318 rg 0 828 595 6 re f"]);
    pageIndex += 1;
    y = 790;
    const repeatedHeader = `${data.fullName || "Curriculum Vitae"}  |  ${data.targetRole || "Professional Profile"}`;
    const repeatedSize = Math.min(9, contentWidth / Math.max(1, pdfTextWidth(repeatedHeader, 1)));
    pushText(repeatedHeader, { size: Math.max(7, repeatedSize), font: "F2", color: "#617268" });
    y -= 13;
    pageOps[pageIndex].push(`0.043 0.463 0.318 RG 0.6 w ${left} ${y} m ${right} ${y} l S`);
    y -= 17;
  };
  const ensureSpace = (height) => {
    if (y - height < footerLimit) addPage();
  };
  const drawLine = (text, { size = 10, font = "F1", color = "#37483f", x = left, gap = lineHeight(size) } = {}) => {
    ensureSpace(gap);
    pushText(text, { size, font, color, x });
    y -= gap;
  };
  const drawBlock = (value, { size = 11, color = "#37483f", font = "F1", after = 5 } = {}) => {
    const sourceLines = String(value || "").replace(/\r\n?/g, "\n").split("\n");
    for (const sourceLine of sourceLines) {
      const cleanLine = pdfPlainText(sourceLine);
      if (!cleanLine) {
        y -= size * 0.42;
        continue;
      }
      const bulletMatch = cleanLine.match(/^(?:[-*]|\d+[.)])\s+(.+)$/);
      const bulletText = bulletMatch ? bulletMatch[1] : cleanLine;
      const indent = bulletMatch ? 13 : 0;
      const wrapped = wrapPdfText(bulletText, contentWidth - indent, size);
      wrapped.forEach((line, index) => {
        const rendered = bulletMatch && index === 0 ? `- ${line}` : line;
        drawLine(rendered, { size, color, font, x: left + (bulletMatch && index > 0 ? indent : 0) });
      });
      y -= 1.5;
    }
    y -= after;
  };
  const drawLabel = (label, bodySize = 10) => {
    ensureSpace(12 + lineHeight(bodySize) + 4);
    drawLine(label.toUpperCase(), { size: 8, font: "F2", color: "#617268", gap: 12 });
  };
  const drawSection = (title) => {
    ensureSpace(43);
    y -= 2;
    drawLine(title.toUpperCase(), { size: 10, font: "F2", color: "#0b7651", gap: 15 });
    pageOps[pageIndex].push(`0.82 0.87 0.84 RG 0.55 w ${left} ${y + 2} m ${right} ${y + 2} l S`);
    y -= 9;
  };

  pageOps[0].push("0.043 0.463 0.318 rg 0 828 595 14 re f");
  const nameLines = wrapPdfText(data.fullName || "Curriculum Vitae", contentWidth, 25);
  nameLines.forEach((line) => drawLine(line, { size: 25, font: "F2", color: "#10281d", gap: 31 }));
  drawLine(data.targetRole || "Professional Profile", { size: 12, font: "F2", color: "#0b7651", gap: 18 });
  const contact = [data.email, data.phone, data.location].filter(Boolean).join("  |  ");
  if (contact) drawBlock(contact, { size: 9, color: "#617268", after: 2 });
  if (data.links) drawBlock(data.links, { size: 9, color: "#617268", after: 3 });
  const personalDetails = [
    data.dateOfBirth && `Date of birth: ${data.dateOfBirth}`,
    data.idNumber && `National ID / passport: ${data.idNumber}`,
  ].filter(Boolean).join("  |  ");
  if (personalDetails) drawBlock(personalDetails, { size: 9, color: "#617268", after: 3 });
  pageOps[0].push(`0.82 0.87 0.84 RG 0.8 w ${left} ${y} m ${right} ${y} l S`);
  y -= 12;

  const renderSection = {
    profile: () => {
      if (!data.profile && data.sectionOrder) return;
      drawSection("Professional profile");
      drawBlock(data.profile);
    },
    objective: () => { if (data.objective) { drawSection("Career objective"); drawBlock(data.objective); } },
    expertise: () => { if (data.expertise) { drawSection("Core expertise"); drawBlock(data.expertise); } },
    practical: () => { if (data.practicalSkills) { drawSection("Practical skills"); drawBlock(data.practicalSkills); } },
    experience: () => {
      if (!data.experience && !data.achievements) return;
      drawSection("Work Experience");
      if (data.experience) { drawLabel("Roles and employers"); drawBlock(data.experience, { after: data.achievements ? 2 : 5 }); }
      if (data.achievements) { drawLabel("Key duties and results"); drawBlock(data.achievements); }
    },
    education: () => { if (data.education && !/^skip$/i.test(data.education)) { drawSection("Education"); drawBlock(data.education); } },
    certifications: () => { if (data.certifications) { drawSection("Certifications and training"); drawBlock(data.certifications); } },
    skills: () => {
      if (!data.skills && !data.technologies && !data.languages) return;
      drawSection("Skills and tools");
      if (data.skills) { drawLabel("Core skills"); drawBlock(data.skills, { color: "#24362d", after: data.technologies || data.languages ? 2 : 5 }); }
      if (data.technologies) { drawLabel("Tools and technology"); drawBlock(data.technologies, { after: data.languages ? 2 : 5 }); }
      if (data.languages) { drawLabel("Languages"); drawBlock(data.languages); }
    },
    projects: () => { if (data.projects) { drawSection("Selected projects"); drawBlock(data.projects); } },
    additional: () => {
      if (!data.awards && !data.volunteering && !data.references) return;
      drawSection("Additional details");
      if (data.awards) { drawLabel("Awards and honours"); drawBlock(data.awards, { after: data.volunteering || data.references ? 2 : 5 }); }
      if (data.volunteering) { drawLabel("Community work"); drawBlock(data.volunteering, { after: data.references ? 2 : 5 }); }
      if (data.references) { drawLabel("References"); drawBlock(data.references); }
    },
  };
  const defaultOrder = ["profile", "objective", "expertise", "practical", "experience", "education", "certifications", "skills", "projects", "additional"];
  for (const section of data.sectionOrder || defaultOrder) renderSection[section]?.();
  for (let index = 0; index < pageOps.length; index += 1) {
    pageOps[index].push(`0.82 0.87 0.84 RG 0.55 w ${left} 43 m ${right} 43 l S`);
    pageOps[index].push(`BT ${colorCommand("#87948c")} /F1 8 Tf 1 0 0 1 ${left} 28 Tm (Prepared with CribMatch CV) Tj ET`);
    const pageLabel = `Page ${index + 1} of ${pageOps.length}`;
    const pageLabelX = right - pdfTextWidth(pageLabel, 8);
    pageOps[index].push(`BT ${colorCommand("#87948c")} /F1 8 Tf 1 0 0 1 ${pageLabelX} 28 Tm (${pdfText(pageLabel)}) Tj ET`);
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
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
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
    "fullName", "targetRole", "email", "phone", "dateOfBirth", "idNumber", "location", "links", "profile", "objective", "expertise",
    "experience_1", "achievements_1", "experience_2", "achievements_2", "experience_3", "achievements_3",
    "education_1", "education_2", "education_3", "certifications_1", "certifications_2", "certifications_3",
    "expertise_1", "expertise_2", "expertise_3", "expertise_4",
    "skills_1", "skills_2", "skills_3", "skills_4",
    "technologies_1", "technologies_2", "technologies_3", "technologies_4",
    "languages_1", "languages_2", "languages_3", "languages_4",
    "projects_1", "projects_2", "projects_3",
    "awards_1", "awards_2", "awards_3", "volunteering_1", "volunteering_2", "volunteering_3",
    "references_1", "references_2", "references_3",
  ];
  const data = {};
  for (const field of fields) data[field] = safeText(parsed[field]);
  data.dateOfBirth = safeFlowDate(data.dateOfBirth);
  // Keep accepting submissions from the existing published Flow's original field names.
  data.experience_1 = data.experience_1 || safeText(parsed.experience);
  data.achievements_1 = data.achievements_1 || safeText(parsed.achievements);
  data.education_1 = data.education_1 || safeText(parsed.education);
  data.certifications_1 = data.certifications_1 || safeText(parsed.certifications);
  data.projects_1 = data.projects_1 || safeText(parsed.projects);
  data.skills_1 = data.skills_1 || safeText(parsed.skills);
  data.technologies_1 = data.technologies_1 || safeText(parsed.technologies);
  data.languages_1 = data.languages_1 || safeText(parsed.languages);
  data.expertise_1 = data.expertise_1 || safeText(parsed.expertise);
  data.awards_1 = data.awards_1 || safeText(parsed.awards);
  data.volunteering_1 = data.volunteering_1 || safeText(parsed.volunteering);
  data.references_1 = data.references_1 || safeText(parsed.references);
  data.experience = [data.experience_1, data.experience_2, data.experience_3].filter(Boolean).join("\n\n");
  data.achievements = [data.achievements_1, data.achievements_2, data.achievements_3].filter(Boolean).join("\n\n");
  data.education = [data.education_1, data.education_2, data.education_3].filter(Boolean).join("\n\n");
  data.certifications = [data.certifications_1, data.certifications_2, data.certifications_3].filter(Boolean).join("\n\n");
  data.projects = [data.projects_1, data.projects_2, data.projects_3].filter(Boolean).join("\n\n");
  data.expertise = [data.expertise_1, data.expertise_2, data.expertise_3, data.expertise_4].filter(Boolean).map((item) => `- ${item}`).join("\n");
  data.awards = [data.awards_1, data.awards_2, data.awards_3].filter(Boolean).map((item) => `- ${item}`).join("\n");
  data.volunteering = [data.volunteering_1, data.volunteering_2, data.volunteering_3].filter(Boolean).join("\n\n");
  data.references = [data.references_1, data.references_2, data.references_3].filter(Boolean).join("\n\n");
  data.skills = [data.skills_1, data.skills_2, data.skills_3, data.skills_4].filter(Boolean).map((item) => `- ${item}`).join("\n");
  data.technologies = [data.technologies_1, data.technologies_2, data.technologies_3, data.technologies_4].filter(Boolean).map((item) => `- ${item}`).join("\n");
  data.languages = [data.languages_1, data.languages_2, data.languages_3, data.languages_4].filter(Boolean).map((item) => `- ${item}`).join("\n");
  if (!data.phone) data.phone = safeText(senderPhone);
  if (data.fullName.length < 3 || !data.targetRole) return null;
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return null;
  return data;
}

async function handleIncomingMessage(db, { id: inboundMessageId, from, text, flowReply }) {
  const normalized = commandText(text);
  if (flowReply) {
    let structuredFacts = null;
    let data = null;
    let parsedFlow = flowReply;
    if (typeof parsedFlow === "string") {
      try { parsedFlow = JSON.parse(parsedFlow); } catch { parsedFlow = null; }
    }
    if (parsedFlow && (parsedFlow.schemaVersion === 2 || parsedFlow.targetRoleId || parsedFlow.goal)) {
      const sourceFacts = parsedFlow.facts || parsedFlow;
      structuredFacts = cleanCandidateFacts(sourceFacts);
      if (!structuredFacts.candidate.phone) structuredFacts.candidate.phone = from;
      if (structuredFacts.candidate.fullName.length >= 3 && structuredFacts.goal.targetRole) data = await writeCandidateCv(structuredFacts);
    } else data = cleanFlowData(flowReply, from);
    if (!data) {
      await sendText(from, "I couldn't read all the required fields. Send START to reopen the CV form and submit it again.");
      return;
    }
    const pdfData = structuredFacts ? data : await polishResumeWithGemini(data);
    const now = new Date();
    await db.collection("cv_whatsapp_submissions").insertOne({ phone: from, data: pdfData, createdAt: now, updatedAt: now });
    const filename = `${data.fullName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "CribMatch-CV"}.pdf`;
    const pdf = buildCvPdf(pdfData);
    if (structuredFacts) {
      const id = crypto.randomUUID();
      const candidateRecordId = crypto.randomUUID();
      const expiresAt = new Date(now.getTime() + 30 * 86400000);
      await db.collection("cv_generation_jobs").updateOne({ _id: inboundMessageId }, { $setOnInsert: { _id: inboundMessageId, channel: "whatsapp", status: "processing", createdAt: now }, $set: { updatedAt: now } }, { upsert: true });
      await db.collection("cv_candidate_facts").insertOne({ _id: candidateRecordId, versionId: id, candidatePhoneDigits: normalizeCandidatePhone(from), facts: structuredFacts, createdAt: now, expiresAt });
      await db.collection("cv_writing_preferences").insertOne({ _id: id, candidateRecordId, preferences: structuredFacts.writingPreferences, createdAt: now, expiresAt });
      await db.collection("cv_generated_wording").insertOne({ _id: id, candidateRecordId, wording: { objective: pdfData.objective, profile: pdfData.profile, achievements: pdfData.achievements }, provider: structuredFacts.writingPreferences.aiConsent && process.env.GEMINI_API_KEY ? "gemini-or-template-fallback" : "template", createdAt: now, expiresAt });
      await db.collection("cv_versions").insertOne({ _id: id, candidateRecordId, status: "draft", channel: "whatsapp", accessKey: crypto.randomBytes(32).toString("base64url"), phoneDigits: from, pdf, filename, createdAt: now, expiresAt });
      await db.collection("cv_generation_jobs").updateOne({ _id: inboundMessageId }, { $set: { status: "completed", versionId: id, updatedAt: new Date(), completedAt: new Date() } });
    }
    await sendPdf(from, pdf, filename, "Your CribMatch CV draft is ready to review.");
    await sendActionButtons(from, "Your CV test PDF is attached. No payment is enabled yet.", [
      { id: "START", title: "Make another CV" },
      { id: "DELETE", title: "Delete my data" },
    ]);
    return;
  }
  if (["delete", "delete my data"].includes(normalized)) {
    const candidateFacts = db.collection("cv_candidate_facts");
    const matchingCandidates = await candidateFacts.find({ candidatePhoneDigits: normalizeCandidatePhone(from) }).project({ versionId: 1 }).toArray();
    const matchingIds = matchingCandidates.map((record) => record.versionId);
    if (matchingIds.length) {
      await Promise.all([
        candidateFacts.deleteMany({ versionId: { $in: matchingIds } }),
        db.collection("cv_writing_preferences").deleteMany({ _id: { $in: matchingIds } }),
        db.collection("cv_generated_wording").deleteMany({ _id: { $in: matchingIds } }),
        db.collection("cv_versions").deleteMany({ _id: { $in: matchingIds } }),
        db.collection("cv_generation_jobs").updateMany({ versionId: { $in: matchingIds }, status: { $in: ["queued", "processing"] } }, { $set: { status: "cancelled", updatedAt: new Date() } }),
      ]);
    }
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
  await Promise.all([
    ...["cv_candidate_facts", "cv_writing_preferences", "cv_generated_wording", "cv_versions"].map((name) => db.collection(name).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {})),
    db.collection("cv_candidate_facts").createIndex({ candidatePhoneDigits: 1 }).catch(() => {}),
  ]);
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
