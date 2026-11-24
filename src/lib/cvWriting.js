import { PERSONAL_QUALITY_OPTIONS, SKILL_LABELS, TASK_LABELS, getRoleConfig } from "@/lib/cvBuilderConfig";

const asText = (value, max = 1800) => String(value || "").trim().slice(0, max);
const listText = (value) => Array.isArray(value) ? value.map((item) => asText(item)).filter(Boolean) : [];

export function normalizeCandidatePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("263")) return digits;
  if (digits.startsWith("0") && digits.length >= 9) return `263${digits.slice(1)}`;
  return digits;
}

export function cleanCandidateFacts(input = {}) {
  const roleId = asText(input?.goal?.targetRoleId, 60) || "other";
  const goal = input?.goal || {};
  const candidate = input?.candidate || {};
  const preferences = input?.writingPreferences || {};
  return {
    schemaVersion: 2,
    goal: {
      applicationType: asText(goal.applicationType, 60) || "employment",
      targetRoleId: roleId,
      targetRole: asText(goal.targetRole, 100) || getRoleConfig(roleId).title,
      targetField: asText(goal.targetField, 120),
      attachmentStartDate: asText(goal.attachmentStartDate, 30),
      attachmentDuration: asText(goal.attachmentDuration, 80),
    },
    candidate: {
      fullName: asText(candidate.fullName, 100),
      phone: asText(candidate.phone, 40),
      email: asText(candidate.email, 120),
      town: asText(candidate.town, 80),
      suburb: asText(candidate.suburb, 80),
      website: asText(candidate.website, 180),
    },
    experienceTypes: listText(input.experienceTypes),
    workExperience: (Array.isArray(input.workExperience) ? input.workExperience : []).slice(0, 6).map((item) => ({
      role: asText(item?.role, 100), employer: asText(item?.employer, 100), startDate: asText(item?.startDate, 30),
      endDate: asText(item?.endDate, 30), current: item?.current === true, tasks: listText(item?.tasks).slice(0, 30),
      otherTasks: asText(item?.otherTasks, 500), achievement: asText(item?.achievement, 500),
      achievementMode: item?.achievementMode === "manual" ? "manual" : "write_for_me",
    })),
    practicalTasks: listText(input.practicalTasks).slice(0, 30),
    education: (Array.isArray(input.education) ? input.education : []).slice(0, 6).map((item) => ({
      level: asText(item?.level, 40), title: asText(item?.title, 120), institution: asText(item?.institution, 120),
      status: asText(item?.status, 30), awardingBody: asText(item?.awardingBody, 40), startYear: asText(item?.startYear, 4),
      endYear: asText(item?.endYear, 4), subjects: asText(item?.subjects, 500), results: asText(item?.results, 500),
      coursework: asText(item?.coursework, 500),
    })),
    selectedSkills: listText(input.selectedSkills).slice(0, 40),
    otherSkills: Array.isArray(input.otherSkills) ? input.otherSkills.map((item) => asText(item, 80)).filter(Boolean).slice(0, 20) : asText(input.otherSkills, 600).split(/[\n;]/).map((item) => asText(item, 80)).filter(Boolean).slice(0, 20),
    personalQualities: listText(input.personalQualities).slice(0, 20),
    languages: (Array.isArray(input.languages) ? input.languages : []).slice(0, 10).map((item) => ({ name: asText(item?.name, 60), proficiency: asText(item?.proficiency, 30) })).filter((item) => item.name),
    availability: asText(input.availability, 120),
    projects: (Array.isArray(input.projects) ? input.projects : []).slice(0, 5).map((item) => ({ name: asText(item?.name, 120), description: asText(item?.description, 700), mode: item?.mode === "manual" ? "manual" : "write_for_me" })).filter((item) => item.name || item.description),
    volunteering: asText(input.volunteering, 500), awards: asText(input.awards, 500), references: asText(input.references, 500),
    writingPreferences: {
      includeObjective: preferences.includeObjective !== false,
      objectiveMode: preferences.objectiveMode === "manual" ? "manual" : "write_for_me",
      objectiveText: asText(preferences.objectiveText, 500),
      profileMode: preferences.profileMode === "manual" ? "manual" : "write_for_me",
      profileText: asText(preferences.profileText, 700), aiConsent: preferences.aiConsent === true,
    },
  };
}

function yearRange(item) {
  const start = item.startYear || "";
  const end = item.status === "current" ? "Present" : item.endYear || "";
  return start && end ? `${start} – ${end}` : start || end;
}

export function candidateFactsToPdfData(facts) {
  const role = facts.goal.targetRole || getRoleConfig(facts.goal.targetRoleId).title;
  const work = facts.workExperience.map((item) => [item.role, item.employer, [item.startDate, item.current ? "Present" : item.endDate].filter(Boolean).join(" – ")].filter(Boolean).join(" | ")).filter(Boolean);
  const tasks = facts.workExperience.flatMap((item) => [...item.tasks.map((id) => TASK_LABELS[id] || id), item.otherTasks]).filter(Boolean);
  const practical = facts.practicalTasks.map((id) => TASK_LABELS[id] || id);
  const edu = facts.education.map((item) => [item.title || item.level, item.institution, yearRange(item), item.status === "current" ? "Currently studying" : item.status === "incomplete" ? "Attended, not completed" : "", item.awardingBody, item.subjects && `Subjects: ${item.subjects}`, item.results && `Results: ${item.results}`, item.coursework && `Coursework: ${item.coursework}`].filter(Boolean).join(" | ")).filter(Boolean);
  const qualityLabels = new Map(PERSONAL_QUALITY_OPTIONS.map(({ id, title }) => [id, title]));
  const skills = [...facts.selectedSkills.map((id) => SKILL_LABELS[id] || id), ...facts.personalQualities.map((id) => qualityLabels.get(id) || id), ...facts.otherSkills].filter(Boolean);
  const objective = !facts.writingPreferences.includeObjective ? "" : facts.writingPreferences.objectiveMode === "manual" ? facts.writingPreferences.objectiveText : `To obtain a ${role} opportunity${tasks.length ? ` where I can contribute confirmed experience in ${tasks.slice(0, 4).join(", ").toLowerCase()}` : " where I can apply my confirmed skills and continue to develop"}.`;
  const profile = facts.writingPreferences.profileMode === "manual" ? facts.writingPreferences.profileText : (work.length
    ? `${role} applicant with experience as ${facts.workExperience.map((item) => item.role).filter(Boolean).join(", ") || "a worker"}${tasks.length ? `, including ${tasks.slice(0, 5).join(", ").toLowerCase()}` : ""}.`
    : facts.education.length ? `${role} applicant with ${facts.education.map((item) => item.title || item.level).filter(Boolean).join(" and ") || "education and training"}${facts.education.some((item) => item.status === "current") ? " currently in progress" : ""}.` : "");
  const duties = tasks.map((task) => `- ${task}`).join("\n");
  const achievements = facts.workExperience.map((item) => item.achievement).filter(Boolean).join("\n");
  const isPracticalRole = ["domestic_worker", "cleaner"].includes(facts.goal.targetRoleId);
  const isAttachment = facts.goal.applicationType === "industrial_attachment" || facts.goal.applicationType === "internship" || facts.goal.applicationType === "apprenticeship";
  const hasWork = Boolean(work.length || achievements);
  const sectionOrder = isPracticalRole
    ? ["objective", "practical", "experience", "education", "skills", "additional"]
    : isAttachment
      ? ["objective", "education", "skills", "projects", "experience", "additional"]
      : !hasWork && edu.length
        ? ["objective", "education", "skills", "projects", "practical", "additional"]
        : ["profile", "objective", "expertise", "experience", "education", "certifications", "skills", "projects", "additional"];
  return {
    fullName: facts.candidate.fullName, targetRole: role, email: facts.candidate.email, phone: facts.candidate.phone,
    location: [facts.candidate.suburb, facts.candidate.town].filter(Boolean).join(", "), links: facts.candidate.website,
    objective, profile, expertise: "", sectionOrder,
    experience: work.join("\n"), achievements: [duties, achievements].filter(Boolean).join("\n"),
    practicalSkills: practical.map((task) => `- ${task}`).join("\n"), education: edu.join("\n"),
    certifications: "", skills: skills.map((skill) => `- ${skill}`).join("\n"),
    languages: facts.languages.map((item) => `- ${item.name}${item.proficiency ? ` (${item.proficiency})` : ""}`).join("\n"),
    projects: facts.projects.map((item) => [item.name, item.description].filter(Boolean).join("\n")).join("\n\n"),
    awards: facts.awards, volunteering: facts.volunteering, references: facts.references,
  };
}

export async function writeCandidateCv(facts) {
  const data = candidateFactsToPdfData(facts);
  if (!facts.writingPreferences.aiConsent || process.env.GEMINI_CV_POLISH_ENABLED === "false" || !process.env.GEMINI_API_KEY) return data;
  const redactProfessionalText = (value) => String(value || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted email]")
    .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, "[redacted phone]")
    .replace(/\b\d{2}-\d{6,7}[A-Z]\d{2}\b/gi, "[redacted identifier]");
  const prompt = [
    "Return JSON with objective, profile, and achievements strings. Improve professional wording only. Use only facts in the input; never invent duties, dates, employers, qualifications, results, skills, licences, or numbers. Do not add a personal quality unless explicitly present. Preserve every blank field as blank. Use concise British English.",
    JSON.stringify({ targetRole: redactProfessionalText(data.targetRole), objective: facts.writingPreferences.objectiveMode === "manual" ? "" : redactProfessionalText(data.objective), profile: facts.writingPreferences.profileMode === "manual" ? "" : redactProfessionalText(data.profile), tasks: facts.workExperience.flatMap((item) => item.tasks.map((id) => TASK_LABELS[id] || id)), achievements: facts.workExperience.filter((item) => item.achievementMode === "write_for_me").map((item) => redactProfessionalText(item.achievement)) }),
  ].join("\n");
  const models = [...new Set([process.env.GEMINI_MODEL || "gemini-3.1-flash-lite", process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite"] )];
  for (const model of models) {
    try {
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
        body: JSON.stringify({ model, input: prompt, store: false }), signal: AbortSignal.timeout(18000),
      });
      if (!response.ok) continue;
      const result = await response.json();
      const output = result?.output_text || (result?.steps || []).filter((step) => step.type === "model_output").flatMap((step) => step.content || []).filter((part) => part.type === "text").map((part) => part.text).join("\n");
      const generated = JSON.parse(String(output).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
      return {
        ...data,
        objective: facts.writingPreferences.objectiveMode === "manual" ? data.objective : (typeof generated.objective === "string" ? generated.objective : data.objective),
        profile: facts.writingPreferences.profileMode === "manual" ? data.profile : (typeof generated.profile === "string" ? generated.profile : data.profile),
        // Duties are built from confirmed task selections; AI wording cannot replace them.
        achievements: data.achievements,
      };
    } catch (error) { console.error("[cv-builder] AI wording fell back to template", error?.message || error); }
  }
  return data;
}
