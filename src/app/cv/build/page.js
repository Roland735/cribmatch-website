"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  APPLICATION_TYPES, AWARDING_BODIES, EDUCATION_LEVELS, EDUCATION_STATUSES, EXPERIENCE_TYPES,
  LANGUAGE_PROFICIENCIES, PERSONAL_QUALITY_OPTIONS, ROLE_LIBRARY, SKILL_LABELS, TASK_LABELS, getRoleConfig,
} from "@/lib/cvBuilderConfig";

const stageNames = ["Your goal", "Contact details", "Experience", "Education and training", "Skills and useful extras", "Check your details"];
const emptyWork = () => ({ role: "", employer: "", startDate: "", endDate: "", current: false, tasks: [], otherTasks: "", achievement: "", achievementMode: "write_for_me" });
const emptyEducation = () => ({ level: "", title: "", institution: "", status: "completed", awardingBody: "", startYear: "", endYear: "", subjects: "", results: "", coursework: "" });
const emptyFacts = {
  goal: { applicationType: "employment", targetRoleId: "other", targetRole: "", targetField: "", attachmentStartDate: "", attachmentDuration: "" },
  candidate: { fullName: "", phone: "", email: "", town: "", suburb: "", website: "" }, experienceTypes: [], workExperience: [emptyWork()], practicalTasks: [], education: [emptyEducation()],
  selectedSkills: [], otherSkills: [""], personalQualities: [], languages: [{ name: "", proficiency: "" }], availability: "", projects: [], volunteering: "", awards: "", references: "",
  writingPreferences: { includeObjective: true, objectiveMode: "write_for_me", objectiveText: "", profileMode: "write_for_me", profileText: "", aiConsent: false },
};

export default function CvBuildPage() {
  const [facts, setFacts] = useState(emptyFacts);
  const [stage, setStage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [requestId, setRequestId] = useState("");
  const roleConfig = useMemo(() => getRoleConfig(facts.goal.targetRoleId), [facts.goal.targetRoleId]);
  const update = (path, value) => setFacts((current) => {
    const next = structuredClone(current);
    let target = next;
    for (const key of path.slice(0, -1)) target = target[key];
    target[path.at(-1)] = value;
    return next;
  });
  const toggle = (path, value) => {
    const current = path.reduce((node, key) => node[key], facts) || [];
    update(path, current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  };
  const add = (key, factory) => update([key], [...facts[key], factory()]);
  const setRole = (id) => setFacts((current) => ({ ...current, goal: { ...current.goal, targetRoleId: id, targetRole: id === "other" ? "" : getRoleConfig(id).title } }));
  const advance = () => {
    setError("");
    if (stage === 0 && !facts.goal.targetRole.trim()) return setError("Enter the job or field you are applying for.");
    if (stage === 1 && (!facts.candidate.fullName.trim() || !facts.candidate.phone.trim())) return setError("Add your full name and a contact number. Email is optional.");
    if (stage < stageNames.length - 1) setStage(stage + 1);
  };
  const generate = async () => {
    setBusy(true); setError("");
    try {
      const stableRequestId = requestId || crypto.randomUUID();
      if (!requestId) setRequestId(stableRequestId);
      const response = await fetch("/api/cv/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ facts, requestId: stableRequestId }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not create your CV draft.");
      setResult(body); setStage(6);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const approve = async () => {
    if (!result?.id) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/cv/version/${result.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: result.key, action: "approve" }) });
      if (!response.ok) throw new Error("Could not confirm this CV. Please try again.");
      setResult((current) => ({ ...current, approved: true }));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const deleteDraft = async () => {
    if (!result?.id || !window.confirm("Permanently delete this CV draft and its saved details?")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/cv/version/${result.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: result.key }) });
      if (!response.ok) throw new Error("Could not delete this draft. Please try again.");
      setResult(null); setFacts(emptyFacts); setStage(0); setRequestId("");
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const downloadHref = result ? `/api/cv/version/${result.id}?key=${encodeURIComponent(result.key)}` : "#";
  const fieldClass = "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15";
  const labelClass = "block text-sm font-semibold text-slate-800";
  const checkList = (options, selected, onChange) => <div className="mt-3 grid gap-2 sm:grid-cols-2">{options.map(({ id, title }) => <label key={id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-800"><input type="checkbox" checked={selected.includes(id)} onChange={() => onChange(id)} className="mt-0.5 accent-emerald-700" />{title}</label>)}</div>;
  const input = (label, value, onChange, props = {}) => <label className={labelClass}>{label}<input className={fieldClass} value={value || ""} onChange={(e) => onChange(e.target.value)} {...props} /></label>;
  const select = (label, value, onChange, options) => <label className={labelClass}>{label}<select className={fieldClass} value={value || ""} onChange={(e) => onChange(e.target.value)}><option value="">Choose an option</option>{options.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>;
  const sectionCard = (title, children) => <section className="space-y-5 rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:p-7"><h2 className="text-lg font-bold text-slate-900">{title}</h2>{children}</section>;

  return <main className="min-h-screen bg-[#f5f7f6] px-4 py-8 text-slate-900 sm:px-6">
    <div className="mx-auto max-w-3xl">
      <Link href="/" className="text-sm font-semibold text-emerald-800">← CribMatch</Link>
      <header className="mt-5"><p className="text-xs font-bold uppercase tracking-[.18em] text-emerald-800">Create your CV</p><h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">A guided CV, built from your real experience.</h1><p className="mt-3 max-w-2xl text-slate-600">Answer a few short questions. Suggestions stay unticked until you confirm them. You can skip optional information and add more entries whenever needed.</p></header>
      {stage < 6 && <div className="mt-7" aria-label={`Stage ${stage + 1} of 6`}><div className="flex justify-between text-xs font-semibold text-slate-600"><span>Stage {stage + 1} of 6</span><span>{stageNames[stage]}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-emerald-700 transition-all" style={{ width: `${((stage + 1) / 6) * 100}%` }} /></div></div>}
      <div className="mt-6 space-y-5">
        {stage === 0 && <>{sectionCard(stageNames[stage], <>
          {select("What are you preparing your CV for?", facts.goal.applicationType, (value) => update(["goal", "applicationType"], value), APPLICATION_TYPES)}
          {select("What job or field are you applying for?", facts.goal.targetRoleId, setRole, ROLE_LIBRARY)}
          {facts.goal.targetRoleId === "other" && input("Job title or field", facts.goal.targetRole, (value) => update(["goal", "targetRole"], value), { required: true, maxLength: 100, placeholder: "For example, farm worker" })}
          {facts.goal.applicationType !== "employment" && <>{input("Attachment or internship field", facts.goal.targetField, (value) => update(["goal", "targetField"], value), { placeholder: "Optional" })}<div className="grid gap-4 sm:grid-cols-2">{input("Available start date", facts.goal.attachmentStartDate, (value) => update(["goal", "attachmentStartDate"], value), { type: "date" })}{input("Required duration", facts.goal.attachmentDuration, (value) => update(["goal", "attachmentDuration"], value), { placeholder: "For example, 6 months" })}</div></>}
          <p className="text-sm font-semibold">Which kinds of experience have you had? <span className="font-normal text-slate-500">Select all that apply.</span></p>{checkList(EXPERIENCE_TYPES, facts.experienceTypes, (id) => toggle(["experienceTypes"], id))}
        </>)}</>}

        {stage === 1 && sectionCard(stageNames[stage], <>
          {input("Full name", facts.candidate.fullName, (value) => update(["candidate", "fullName"], value), { required: true, autoComplete: "name" })}
          <div className="grid gap-4 sm:grid-cols-2">{input("Phone number", facts.candidate.phone, (value) => update(["candidate", "phone"], value), { required: true, type: "tel", autoComplete: "tel" })}{input("Email address (optional)", facts.candidate.email, (value) => update(["candidate", "email"], value), { type: "email", autoComplete: "email" })}</div>
          <div className="grid gap-4 sm:grid-cols-2">{input("Town or city (optional)", facts.candidate.town, (value) => update(["candidate", "town"], value), { autoComplete: "address-level2" })}{input("Suburb (optional)", facts.candidate.suburb, (value) => update(["candidate", "suburb"], value))}</div>
          {input("LinkedIn or website (optional)", facts.candidate.website, (value) => update(["candidate", "website"], value), { type: "url", placeholder: "https://" })}
          <p className="text-sm text-slate-600">Date of birth and national ID are not requested. Add them only if a specific employer requires them.</p>
        </>)}

        {stage === 2 && <>{sectionCard(stageNames[stage], <>
          <p className="text-sm text-slate-600">Only describe work or activities you actually did. Role-based task suggestions start unticked.</p>
          {facts.workExperience.map((item, index) => <div key={index} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between"><h3 className="font-semibold">Work or practical experience {index + 1}</h3>{facts.workExperience.length > 1 && <button type="button" onClick={() => update(["workExperience"], facts.workExperience.filter((_, i) => i !== index))} className="text-sm text-red-700">Remove</button>}</div>
            <div className="grid gap-4 sm:grid-cols-2">{input("Role or activity", item.role, (v) => update(["workExperience", index, "role"], v), { placeholder: "For example, shop assistant" })}{input("Employer or organisation", item.employer, (v) => update(["workExperience", index, "employer"], v), { placeholder: "Optional for household or personal work" })}</div>
            <div className="grid gap-4 sm:grid-cols-2">{input("Start date or year", item.startDate, (v) => update(["workExperience", index, "startDate"], v), { placeholder: "YYYY or month YYYY" })}{input("End date or year", item.endDate, (v) => update(["workExperience", index, "endDate"], v), { placeholder: "YYYY or month YYYY", disabled: item.current })}</div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={item.current} onChange={(e) => update(["workExperience", index, "current"], e.target.checked)} className="accent-emerald-700" />I still do this</label>
            <p className="text-sm font-semibold">Which tasks did you actually do in this role? <span className="font-normal text-slate-500">Select only true items.</span></p>
            {checkList(roleConfig.tasks.map((id) => ({ id, title: TASK_LABELS[id] || id })), item.tasks, (id) => update(["workExperience", index, "tasks"], item.tasks.includes(id) ? item.tasks.filter((task) => task !== id) : [...item.tasks, id]))}
            {input("Add another task (optional)", item.otherTasks, (v) => update(["workExperience", index, "otherTasks"], v), { placeholder: "Describe any task not listed" })}
            <label className={labelClass}>Achievement or result (optional)
              <div className="mt-2 flex flex-wrap gap-4 text-sm font-normal"><label><input type="radio" checked={item.achievementMode === "write_for_me"} onChange={() => update(["workExperience", index, "achievementMode"], "write_for_me")} className="mr-2 accent-emerald-700" />Help me write it</label><label><input type="radio" checked={item.achievementMode === "manual"} onChange={() => update(["workExperience", index, "achievementMode"], "manual")} className="mr-2 accent-emerald-700" />I’ll write it</label></div>
              {item.achievementMode === "manual" && <textarea className={fieldClass} rows={3} value={item.achievement} onChange={(e) => update(["workExperience", index, "achievement"], e.target.value)} placeholder="Only include a result you can confirm." />}
            </label>
          </div>)}
          <button type="button" onClick={() => add("workExperience", emptyWork)} className="rounded-lg border border-emerald-800 px-4 py-2 text-sm font-semibold text-emerald-900">＋ Add another experience</button>
        </>)}
        {sectionCard("Practical abilities (optional)", <><p className="text-sm text-slate-600">If you have no work history, select tasks you can confidently do. These appear as Practical Skills, not work experience.</p>{checkList(roleConfig.tasks.map((id) => ({ id, title: TASK_LABELS[id] || id })), facts.practicalTasks, (id) => toggle(["practicalTasks"], id))}</>)}</>}

        {stage === 3 && sectionCard(stageNames[stage], <>
          <p className="text-sm text-slate-600">List what you actually studied. Incomplete and current studies are welcome. Do not enter results you have not received.</p>
          {facts.education.map((item, index) => <div key={index} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between"><h3 className="font-semibold">Education or training {index + 1}</h3>{facts.education.length > 1 && <button type="button" onClick={() => update(["education"], facts.education.filter((_, i) => i !== index))} className="text-sm text-red-700">Remove</button>}</div>
            <div className="grid gap-4 sm:grid-cols-2">{select("Level", item.level, (v) => update(["education", index, "level"], v), EDUCATION_LEVELS)}{input("Qualification or course (optional)", item.title, (v) => update(["education", index, "title"], v), { placeholder: "For example, O Level" })}</div>
            <div className="grid gap-4 sm:grid-cols-2">{input("School or training provider", item.institution, (v) => update(["education", index, "institution"], v))}{select("Status", item.status, (v) => update(["education", index, "status"], v), EDUCATION_STATUSES)}</div>
            <div className="grid gap-4 sm:grid-cols-2">{select("Awarding body (optional)", item.awardingBody, (v) => update(["education", index, "awardingBody"], v), AWARDING_BODIES)}<div className="grid grid-cols-2 gap-3">{input("Start year", item.startYear, (v) => update(["education", index, "startYear"], v), { inputMode: "numeric", maxLength: 4, placeholder: "2022" })}{input("End or expected year", item.endYear, (v) => update(["education", index, "endYear"], v), { inputMode: "numeric", maxLength: 4, placeholder: "2026" })}</div></div>
            {input("Subjects studied (optional)", item.subjects, (v) => update(["education", index, "subjects"], v), { placeholder: "Add subjects separated by semicolons" })}
            {input("Results received (optional)", item.results, (v) => update(["education", index, "results"], v), { placeholder: "Enter actual results only" })}
            {input("Relevant modules or coursework studied (optional)", item.coursework, (v) => update(["education", index, "coursework"], v))}
          </div>)}
          <button type="button" onClick={() => add("education", emptyEducation)} className="rounded-lg border border-emerald-800 px-4 py-2 text-sm font-semibold text-emerald-900">＋ Add education or training</button>
        </>)}

        {stage === 4 && <>{sectionCard(stageNames[stage], <>
          <p className="text-sm font-semibold">Suggested skills for {facts.goal.targetRole || roleConfig.title} <span className="font-normal text-slate-500">(all start unticked)</span></p>
          {checkList(roleConfig.skills.map((id) => ({ id, title: SKILL_LABELS[id] || id })), facts.selectedSkills, (id) => toggle(["selectedSkills"], id))}
          <div className="space-y-3"><p className="text-sm font-semibold">Add another skill (optional)</p>{facts.otherSkills.map((skill, index) => <div key={index} className="flex gap-3">{input(`Additional skill ${index + 1}`, skill, (v) => update(["otherSkills", index], v), { placeholder: "One skill per entry" })}{facts.otherSkills.length > 1 && <button type="button" onClick={() => update(["otherSkills"], facts.otherSkills.filter((_, i) => i !== index))} className="mt-7 text-sm text-red-700">Remove</button>}</div>)}<button type="button" onClick={() => update(["otherSkills"], [...facts.otherSkills, ""])} className="rounded-lg border border-emerald-800 px-4 py-2 text-sm font-semibold text-emerald-900">＋ Add another skill</button></div>
          <p className="text-sm font-semibold">Which qualities describe you? <span className="font-normal text-slate-500">Choose only those that are true.</span></p>{checkList(PERSONAL_QUALITY_OPTIONS, facts.personalQualities, (id) => toggle(["personalQualities"], id))}
          <div className="space-y-3"><p className="text-sm font-semibold">Languages <span className="font-normal text-slate-500">(optional, add each separately)</span></p>{facts.languages.map((item, index) => <div key={index} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">{input("Language", item.name, (v) => update(["languages", index, "name"], v), { placeholder: "Shona" })}{select("Proficiency", item.proficiency, (v) => update(["languages", index, "proficiency"], v), LANGUAGE_PROFICIENCIES)}{facts.languages.length > 1 && <button type="button" onClick={() => update(["languages"], facts.languages.filter((_, i) => i !== index))} className="text-sm text-red-700">Remove</button>}</div>)}<button type="button" onClick={() => add("languages", () => ({ name: "", proficiency: "" }))} className="rounded-lg border border-emerald-800 px-4 py-2 text-sm font-semibold text-emerald-900">＋ Add another language</button></div>
          {input("Availability (optional)", facts.availability, (v) => update(["availability"], v), { placeholder: "For example, available immediately" })}
          <details className="rounded-xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer font-semibold">Optional projects, awards, volunteering and references</summary><div className="mt-4 space-y-4"><div className="space-y-3"><p className="text-sm font-semibold">Projects you completed</p>{facts.projects.map((project, index) => <div key={index} className="space-y-2 rounded-lg border border-slate-200 p-3">{input(`Project ${index + 1} name`, project.name, (v) => update(["projects", index, "name"], v))}{input("What did you do?", project.description, (v) => update(["projects", index, "description"], v))}{facts.projects.length > 1 && <button type="button" onClick={() => update(["projects"], facts.projects.filter((_, i) => i !== index))} className="text-sm text-red-700">Remove project</button>}</div>)}<button type="button" onClick={() => add("projects", () => ({ name: "", description: "", mode: "write_for_me" }))} className="rounded-lg border border-emerald-800 px-4 py-2 text-sm font-semibold text-emerald-900">＋ Add another project</button></div>{input("Awards or recognition (optional)", facts.awards, (v) => update(["awards"], v))}{input("Volunteering or community work (optional)", facts.volunteering, (v) => update(["volunteering"], v))}{input("Referees (optional)", facts.references, (v) => update(["references"], v), { placeholder: "Enter only with their permission" })}</div></details>
        </>)}
        {sectionCard("Writing choices", <>
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={facts.writingPreferences.includeObjective} onChange={(e) => update(["writingPreferences", "includeObjective"], e.target.checked)} className="mt-1 accent-emerald-700" />Include a tailored career objective by default</label>
          <label className="block text-sm font-semibold">Career objective
            <div className="mt-2 flex gap-5 text-sm font-normal"><label><input type="radio" checked={facts.writingPreferences.objectiveMode === "write_for_me"} onChange={() => update(["writingPreferences", "objectiveMode"], "write_for_me")} className="mr-2 accent-emerald-700" />Write for me</label><label><input type="radio" checked={facts.writingPreferences.objectiveMode === "manual"} onChange={() => update(["writingPreferences", "objectiveMode"], "manual")} className="mr-2 accent-emerald-700" />I’ll write it</label></div>
            {facts.writingPreferences.objectiveMode === "manual" && <textarea className={fieldClass} rows={3} value={facts.writingPreferences.objectiveText} onChange={(e) => update(["writingPreferences", "objectiveText"], e.target.value)} />}
          </label>
          <label className="block text-sm font-semibold">Professional profile <span className="font-normal text-slate-500">(optional)</span><div className="mt-2 flex gap-5 text-sm font-normal"><label><input type="radio" checked={facts.writingPreferences.profileMode === "write_for_me"} onChange={() => update(["writingPreferences", "profileMode"], "write_for_me")} className="mr-2 accent-emerald-700" />Write for me</label><label><input type="radio" checked={facts.writingPreferences.profileMode === "manual"} onChange={() => update(["writingPreferences", "profileMode"], "manual")} className="mr-2 accent-emerald-700" />I’ll write it</label></div>{facts.writingPreferences.profileMode === "manual" && <textarea className={fieldClass} rows={3} value={facts.writingPreferences.profileText} onChange={(e) => update(["writingPreferences", "profileText"], e.target.value)} />}</label>
          <label className="flex items-start gap-3 rounded-xl bg-amber-50 p-4 text-sm text-slate-800"><input type="checkbox" checked={facts.writingPreferences.aiConsent} onChange={(e) => update(["writingPreferences", "aiConsent"], e.target.checked)} className="mt-1 accent-emerald-700" /><span><strong>Optional AI wording help.</strong> If selected, CribMatch sends limited professional CV details (such as target role and confirmed duties) to Google Gemini to improve wording. Contact and identity details are excluded. If AI is unavailable, a template is used. Leave unticked to use the template only.</span></label>
        </> )}</>}

        {stage === 5 && sectionCard(stageNames[stage], <>
          <p className="text-sm text-slate-600">Check your information. Nothing has been assumed; only confirmed task and skill selections are included.</p>
          <dl className="grid gap-4 sm:grid-cols-2">{[["Applying for", facts.goal.targetRole], ["Application type", APPLICATION_TYPES.find((x) => x.id === facts.goal.applicationType)?.title], ["Name", facts.candidate.fullName], ["Phone", facts.candidate.phone], ["Email", facts.candidate.email || "Not provided"], ["Experience entries", String(facts.workExperience.filter((item) => item.role || item.employer || item.tasks.length).length)], ["Education entries", String(facts.education.filter((item) => item.title || item.level || item.institution).length)], ["Confirmed skills", [...facts.selectedSkills.map((id) => SKILL_LABELS[id] || id), ...facts.otherSkills.filter(Boolean)].join(", ") || "None selected"]].map(([key, value]) => <div key={key} className="rounded-xl bg-white p-4"><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{key}</dt><dd className="mt-1 break-words text-sm">{value}</dd></div>)}</dl>
          <p className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-950">You will receive a draft CV to review. Choose “Looks correct” to approve it, or edit details and create another draft.</p>
        </>)}
        {stage === 6 && result && <section className="space-y-5 rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm sm:p-7"><p className="text-xs font-bold uppercase tracking-[.18em] text-emerald-800">Draft ready</p><h2 className="text-2xl font-bold">Review your CV</h2><p className="text-slate-600">Download and check every detail. Approval confirms this exact version.</p><div className="flex flex-wrap gap-3"><a href={downloadHref} download className="rounded-full bg-emerald-800 px-5 py-3 text-sm font-bold text-white">Download PDF</a>{!result.approved ? <button type="button" disabled={busy} onClick={approve} className="rounded-full border border-emerald-800 px-5 py-3 text-sm font-bold text-emerald-900">Looks correct</button> : <span className="rounded-full bg-emerald-50 px-5 py-3 text-sm font-bold text-emerald-900">Approved</span>}<button type="button" onClick={() => { setResult(null); setStage(1); setRequestId(""); }} className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold">Edit details</button><button type="button" onClick={() => { setResult(null); setStage(0); setRequestId(""); }} className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold">Tailor to another job</button><button type="button" disabled={busy} onClick={deleteDraft} className="rounded-full border border-red-300 px-5 py-3 text-sm font-semibold text-red-800">Delete saved CV</button></div><iframe title="CV PDF preview" src={downloadHref} className="h-[70vh] w-full rounded-xl border border-slate-200" /></section>}
      </div>
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}
      {stage < 5 && <div className="mt-6 flex justify-between"><button type="button" disabled={stage === 0} onClick={() => { setError(""); setStage(stage - 1); }} className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold disabled:opacity-40">Back</button><div className="flex gap-3">{stage >= 2 && <button type="button" onClick={() => { setError(""); setStage(stage + 1); }} className="rounded-full px-4 py-3 text-sm font-semibold text-slate-600">Skip optional details</button>}<button type="button" onClick={advance} className="rounded-full bg-emerald-800 px-6 py-3 text-sm font-bold text-white">Continue</button></div></div>}
      {stage === 5 && <div className="mt-6 flex justify-between"><button type="button" onClick={() => setStage(4)} className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold">Back</button><button type="button" onClick={generate} disabled={busy} className="rounded-full bg-emerald-800 px-6 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? "Preparing draft…" : "Create draft CV"}</button></div>}
      <p className="mt-8 text-xs leading-5 text-slate-500">Your CV data is used to create and deliver your document. Send DELETE on WhatsApp to remove WhatsApp test data. Website CV drafts expire after 30 days.</p>
    </div>
  </main>;
}
