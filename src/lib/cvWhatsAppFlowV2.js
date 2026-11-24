import {
  APPLICATION_TYPES, AWARDING_BODIES, EDUCATION_LEVELS, EDUCATION_STATUSES, EXPERIENCE_TYPES,
  LANGUAGE_PROFICIENCIES, PERSONAL_QUALITY_OPTIONS, ROLE_LIBRARY, SKILL_LABELS, TASK_LABELS,
} from "./cvBuilderConfig.js";

const optionRows = (items) => items.map(({ id, title }) => ({ id, title }));
const input = (type, name, label, options = {}) => {
  return {
    type, name, label,
    ...(type === "TextInput" ? { "max-chars": options.maxChars || 120, ...(options.inputType ? { "input-type": options.inputType } : {}) } : {}),
    ...(type === "TextArea" ? { "max-length": options.maxLength || 600 } : {}),
    ...(type === "DatePicker" ? {} : {}),
    ...(type === "Dropdown" || type === "RadioButtonsGroup" || type === "CheckboxGroup" ? { "data-source": options.options || [] } : {}),
    ...(options.required ? { required: true } : {}),
    ...(options.helperText ? { "helper-text": options.helperText } : {}),
  };
};
const text = (name, label, options) => input("TextInput", name, label, options);
const area = (name, label, options) => input("TextArea", name, label, options);
const check = (name, label, options) => input("CheckboxGroup", name, label, options);
const opt = (name, label) => input("OptIn", name, label);
const iff = (condition, then) => ({ type: "If", condition, then });

function roleSuggestions(source, keyPrefix, labels) {
  return ROLE_LIBRARY.map((role) => iff(`\${data.targetRoleId} == '${role.id}'`, [
    check(`${keyPrefix}_${role.id}`, `${role.title}: choose only what is true`, { options: optionRows(role[source].map((id) => ({ id, title: labels[id] || id }))) }),
  ]));
}

function screenData(fields) {
  return Object.fromEntries(fields.map(({ name, valueType }) => [name, {
    type: valueType,
    ...(valueType === "array" ? { items: { type: "string" }, __example__: [] } : { __example__: valueType === "boolean" ? false : "Example" }),
  }]));
}

function makeScreen({ id, title, section, fields, previousFields = [], terminal = false }) {
  const known = [...previousFields, ...fields.map(({ name, valueType }) => ({ name, valueType }))];
  const payload = Object.fromEntries(known.map(({ name }) => [name, previousFields.some((item) => item.name === name) ? `\${data.${name}}` : `\${form.${name}}`]));
  const next = section.next;
  return {
    id, title,
    ...(terminal ? { terminal: true, success: true } : {}),
    data: screenData(previousFields),
    layout: {
      type: "SingleColumnLayout",
      children: [{
        type: "Form", name: `${id.toLowerCase()}_form`, children: [
          { type: "TextSubheading", text: title },
          ...(section.intro ? [{ type: "TextBody", text: section.intro }] : []),
          ...section.children,
          { type: "Footer", label: terminal ? "Create my CV" : "Continue", "on-click-action": terminal ? { name: "complete", payload } : { name: "navigate", next: { type: "screen", name: next }, payload } },
        ],
      }],
    },
  };
}

const appOptions = optionRows(APPLICATION_TYPES);
const expOptions = optionRows(EXPERIENCE_TYPES).map((option) => ({
  ...option,
  title: ({
    casual: "Casual or family business",
    volunteering: "Volunteering/community",
    other: "Other practical activity",
  })[option.id] || option.title,
}));
const roleOptions = optionRows(ROLE_LIBRARY);
const educationLevels = optionRows(EDUCATION_LEVELS);
const educationStatuses = optionRows(EDUCATION_STATUSES);
const awardingBodies = optionRows(AWARDING_BODIES);
const proficiencies = optionRows(LANGUAGE_PROFICIENCIES);
const qualities = optionRows(PERSONAL_QUALITY_OPTIONS).map((option) => ({
  ...option,
  title: ({ team_oriented: "Teamwork", follows_instructions: "Follows instructions" })[option.id] || option.title,
}));

const goalFields = [
  { name: "applicationType", valueType: "string" }, { name: "targetRoleId", valueType: "string" }, { name: "targetRole", valueType: "string" },
  { name: "targetField", valueType: "string" }, { name: "attachmentStartDate", valueType: "string" }, { name: "attachmentDuration", valueType: "string" }, { name: "experienceTypes", valueType: "array" },
];
const contactFields = ["fullName", "phone", "email", "dateOfBirth", "idNumber", "location", "links", "objectiveManual", "objectiveManualText", "profileManual", "profileManualText", "aiConsent"].map((name) => ({ name, valueType: ["objectiveManual", "profileManual", "aiConsent"].includes(name) ? "boolean" : "string" }));
const experienceNames = ["experience_1", "employer_1", "startDate_1", "endDate_1", "current_1", ...ROLE_LIBRARY.map((role) => `workTasks_1_${role.id}`), "otherTasks_1", "manualDuties_1", "achievements_1", "add_experience_2", "experience_2", "employer_2", "startDate_2", "endDate_2", "current_2", "otherTasks_2", "manualDuties_2", "achievements_2", ...ROLE_LIBRARY.map((role) => `practicalTasks_${role.id}`), "personalQualities"];
const experienceFields = experienceNames.map((name) => ({ name, valueType: ["current_1", "manualDuties_1", "add_experience_2", "current_2", "manualDuties_2"].includes(name) ? "boolean" : ["personalQualities", ...ROLE_LIBRARY.map((role) => `workTasks_1_${role.id}`), ...ROLE_LIBRARY.map((role) => `practicalTasks_${role.id}`)].includes(name) ? "array" : "string" }));
const educationNames = ["education_1", "educationLevel_1", "educationStatus_1", "educationBody_1", "educationStartYear_1", "educationEndYear_1", "educationSubjects_1", "educationResults_1", "educationCoursework_1", "add_education_2", "education_2", "educationLevel_2", "educationStatus_2", "educationBody_2", "educationStartYear_2", "educationEndYear_2", "educationSubjects_2", "educationResults_2", "educationCoursework_2", "certifications_1", "add_certification_2", "certifications_2"];
const educationFields = educationNames.map((name) => ({ name, valueType: ["add_education_2", "add_certification_2"].includes(name) ? "boolean" : "string" }));
const skillNames = [...ROLE_LIBRARY.map((role) => `skillSuggestions_${role.id}`), "skills_1", "add_skills_2", "skills_2", "technologies_1", "add_technologies_2", "technologies_2", "languages_1", "add_languages_2", "languages_2", "projects_1", "projectsDescription_1", "add_projects_2", "projects_2", "projectsDescription_2", "awards", "volunteering", "references", "availability", "skillsOther"];
const skillFields = skillNames.map((name) => ({ name, valueType: ["add_skills_2", "add_technologies_2", "add_languages_2", "add_projects_2"].includes(name) ? "boolean" : ROLE_LIBRARY.some((role) => name === `skillSuggestions_${role.id}`) ? "array" : "string" }));

function roleChoiceComponents(prefix, source, labels) {
  return roleSuggestions(source, prefix, labels);
}

export const CV_FLOW_V2_JSON = {
  version: "7.3",
  routing_model: { GOAL: ["CONTACT"], CONTACT: ["EXPERIENCE"], EXPERIENCE: ["EDUCATION"], EDUCATION: ["SKILLS"], SKILLS: ["REVIEW"], REVIEW: [] },
  screens: [
    makeScreen({ id: "GOAL", title: "Your goal", fields: goalFields, section: { next: "CONTACT", intro: "First choose the kind of opportunity and job you want.", children: [
      input("Dropdown", "applicationType", "CV purpose", { required: true, options: appOptions }),
      input("Dropdown", "targetRoleId", "Target job or field", { required: true, options: roleOptions }),
      text("targetRole", "Target job title", { required: true, helperText: "Use the role name above or enter your specific title." }),
      text("targetField", "Field (optional)"),
      input("DatePicker", "attachmentStartDate", "Available start (optional)"),
      text("attachmentDuration", "Duration (optional)", { helperText: "For example, 6 months." }),
      check("experienceTypes", "Which kinds of experience have you had? Select all that apply.", { options: expOptions }),
    ] } }),
    makeScreen({ id: "CONTACT", title: "Contact details", fields: contactFields, previousFields: goalFields, section: { next: "EXPERIENCE", intro: "Your phone number can be your WhatsApp contact. Email is optional.", children: [
      text("fullName", "Full name", { required: true, maxChars: 80 }),
      text("phone", "Phone number", { required: true, maxChars: 32, inputType: "phone" }),
      text("email", "Email", { maxChars: 100, inputType: "email" }),
      input("DatePicker", "dateOfBirth", "Date of birth", { helperText: "Optional; add it only if the employer or application requires it." }),
      text("idNumber", "ID or passport", { maxChars: 120, helperText: "Optional; enter the official ID requested for this application." }),
      text("location", "Town or city", { maxChars: 80 }),
      text("links", "LinkedIn or website", { maxChars: 180 }),
      opt("objectiveManual", "I want to write my career objective myself"),
      iff("\${form.objectiveManual} == true", [area("objectiveManualText", "Career objective", { maxLength: 300 })]),
      opt("profileManual", "I want to write my professional profile myself"),
      iff("\${form.profileManual} == true", [area("profileManualText", "Professional profile (optional)", { maxLength: 600 })]),
      opt("aiConsent", "Use optional Google Gemini help to improve wording (details below)"),
      { type: "TextBody", text: "If selected, only professional details such as your target role and confirmed tasks are sent to Google Gemini. Your name and contact details are excluded. Leave this unticked to use template writing." },
    ] } }),
    makeScreen({ id: "EXPERIENCE", title: "Your experience", fields: experienceFields, previousFields: [...goalFields, ...contactFields], section: { next: "EDUCATION", intro: "Describe work you actually did. Task suggestions start unchecked. If you have no jobs, skip work entries and select only practical abilities you can confidently do.", children: [
      text("experience_1", "Role or activity", { maxChars: 100 }), text("employer_1", "Employer", { maxChars: 100 }),
      text("startDate_1", "Start date/year", { helperText: "A year such as 2022 is fine." }), text("endDate_1", "End date/year"),
      opt("current_1", "I still do this"),
      ...roleChoiceComponents("workTasks_1", "tasks", TASK_LABELS),
      area("otherTasks_1", "Other tasks", { maxLength: 450 }),
      opt("manualDuties_1", "I want to write these duties myself"),
      iff("\${form.manualDuties_1} == true", [area("achievements_1", "Duties or results (optional)", { maxLength: 450 })]),
      opt("add_experience_2", "＋ Add another work or activity entry"),
      iff("\${form.add_experience_2} == true", [
        text("experience_2", "Second role/activity", { maxChars: 100 }), text("employer_2", "Employer", { maxChars: 100 }),
        text("startDate_2", "Start date/year"), text("endDate_2", "End date/year"), opt("current_2", "I still do this"),
        area("otherTasks_2", "Other tasks", { maxLength: 450 }),
        opt("manualDuties_2", "I want to write these duties myself"), iff("\${form.manualDuties_2} == true", [area("achievements_2", "Duties or results (optional)", { maxLength: 450 })]),
      ]),
      { type: "TextSubheading", text: "Practical abilities" },
      ...roleChoiceComponents("practicalTasks", "tasks", TASK_LABELS),
      check("personalQualities", "Which qualities describe you? Confirm only those that are true.", { options: qualities }),
    ] } }),
    makeScreen({ id: "EDUCATION", title: "Education and training", fields: educationFields, previousFields: [...goalFields, ...contactFields, ...experienceFields], section: { next: "SKILLS", intro: "You can list current or incomplete study. Enter only results you have actually received.", children: [
      text("education_1", "Qualification/course", { maxChars: 120 }),
      input("Dropdown", "educationLevel_1", "Education level", { options: educationLevels }),
      input("Dropdown", "educationStatus_1", "Study status", { options: educationStatuses }),
      input("Dropdown", "educationBody_1", "Awarding body", { options: awardingBodies }),
      text("educationStartYear_1", "Start year", { maxChars: 4 }), text("educationEndYear_1", "End/expected year", { maxChars: 4 }),
      area("educationSubjects_1", "Subjects", { maxLength: 300 }), area("educationResults_1", "Results received", { maxLength: 300 }),
      area("educationCoursework_1", "Relevant coursework", { maxLength: 300 }),
      opt("add_education_2", "＋ Add another education or training entry"),
      iff("\${form.add_education_2} == true", [
        text("education_2", "Second qualification", { maxChars: 120 }),
        input("Dropdown", "educationLevel_2", "Education level", { options: educationLevels }),
        input("Dropdown", "educationStatus_2", "Study status", { options: educationStatuses }),
        input("Dropdown", "educationBody_2", "Awarding body", { options: awardingBodies }),
        text("educationStartYear_2", "Start year", { maxChars: 4 }), text("educationEndYear_2", "End/expected year", { maxChars: 4 }),
        area("educationSubjects_2", "Subjects", { maxLength: 300 }), area("educationResults_2", "Results received", { maxLength: 300 }),
        area("educationCoursework_2", "Relevant coursework", { maxLength: 300 }),
      ]),
      text("certifications_1", "Certificate/course", { maxChars: 180 }),
      opt("add_certification_2", "＋ Add another certificate or short course"),
      iff("\${form.add_certification_2} == true", [text("certifications_2", "Second certificate", { maxChars: 180 })]),
    ] } }),
    makeScreen({ id: "SKILLS", title: "Skills and extras", fields: skillFields, previousFields: [...goalFields, ...contactFields, ...experienceFields, ...educationFields], section: { next: "REVIEW", intro: "These suggestions are not selected automatically. Select only confirmed skills and add entries one at a time.", children: [
      ...roleChoiceComponents("skillSuggestions", "skills", SKILL_LABELS),
      text("skills_1", "Skill", { maxChars: 100 }), opt("add_skills_2", "＋ Add another skill"), iff("\${form.add_skills_2} == true", [text("skills_2", "Second skill", { maxChars: 100 })]),
      text("technologies_1", "Tool/technology", { maxChars: 100 }), opt("add_technologies_2", "＋ Add another tool or technology"), iff("\${form.add_technologies_2} == true", [text("technologies_2", "Second tool", { maxChars: 100 })]),
      text("languages_1", "Language/proficiency", { maxChars: 100 }), opt("add_languages_2", "＋ Add another language"), iff("\${form.add_languages_2} == true", [text("languages_2", "Second language", { maxChars: 100 })]),
      text("projects_1", "Project name", { maxChars: 100 }), area("projectsDescription_1", "Project details", { maxLength: 300 }),
      opt("add_projects_2", "＋ Add another project"), iff("\${form.add_projects_2} == true", [text("projects_2", "Second project", { maxChars: 100 }), area("projectsDescription_2", "Project details", { maxLength: 300 })]),
      area("awards", "Awards", { maxLength: 250 }), area("volunteering", "Community work", { maxLength: 300 }),
      area("references", "Referees", { maxLength: 300, helperText: "Ask their permission before listing their details." }), text("availability", "Availability", { maxChars: 100 }),
      area("skillsOther", "Other skills", { maxLength: 300 }),
    ] } }),
    makeScreen({ id: "REVIEW", title: "Review and submit", terminal: true, section: { intro: "Check the information you entered in the previous steps. Your draft CV will be prepared and sent here for review.", children: [
      { type: "TextBody", text: "Review your details on the previous screens, then submit. Use Back if you need to make a change." },
      { type: "TextBody", text: "Your details are used to prepare a draft CV. Date of birth and ID/passport are optional; share them only when required for your application." },
    ] }, fields: [], previousFields: [...goalFields, ...contactFields, ...experienceFields, ...educationFields, ...skillFields] }),
  ],
};

export function getCvWhatsAppFlowV2Json() {
  return JSON.stringify(CV_FLOW_V2_JSON);
}
