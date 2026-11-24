import { describe, expect, it, vi } from "vitest";
import { candidateFactsToPdfData, cleanCandidateFacts, writeCandidateCv } from "@/lib/cvWriting";

vi.mock("@/lib/mongodb", () => ({ default: Promise.resolve({}) }));
const { buildCvPdf } = await import("@/lib/whatsappResumeBuilder");

describe("CV facts and wording", () => {
  it("keeps domestic practical abilities separate from work history", () => {
    const facts = cleanCandidateFacts({
      goal: { targetRoleId: "domestic_worker", targetRole: "Domestic worker" },
      practicalTasks: ["laundry", "ironing"],
      workExperience: [],
    });
    const cv = candidateFactsToPdfData(facts);
    expect(cv.experience).toBe("");
    expect(cv.practicalSkills).toContain("Laundry");
    expect(cv.practicalSkills).toContain("Ironing");
    expect(cv.objective).toContain("Domestic worker");
  });

  it("places an attachment student's studies before work and preserves year-only dates", () => {
    const facts = cleanCandidateFacts({
      goal: { applicationType: "industrial_attachment", targetRoleId: "accounting", targetRole: "Accounting attachment" },
      education: [{ title: "Accounting", institution: "College", status: "current", startYear: "2024", coursework: "Financial accounting" }],
      workExperience: [],
    });
    const cv = candidateFactsToPdfData(facts);
    expect(cv.sectionOrder.indexOf("education")).toBeLessThan(cv.sectionOrder.indexOf("experience"));
    expect(cv.education).toContain("2024");
    expect(cv.education).toContain("Coursework: Financial accounting");
    expect(cv.education).not.toContain("NaN");
  });

  it("includes both education and casual work when supplied", () => {
    const facts = cleanCandidateFacts({
      goal: { targetRoleId: "shop_assistant", targetRole: "Shop assistant" },
      education: [{ title: "O Level", status: "incomplete", institution: "School" }],
      experienceTypes: ["casual"],
      workExperience: [{ role: "Shop helper", employer: "Family shop", tasks: ["customer_help"] }],
    });
    const cv = candidateFactsToPdfData(facts);
    expect(cv.experience).toContain("Shop helper");
    expect(cv.achievements).toContain("Helping customers");
    expect(cv.education).toContain("Attended, not completed");
  });

  it("keeps manual writing and only the task selections still present", () => {
    const facts = cleanCandidateFacts({
      goal: { targetRoleId: "cleaner", targetRole: "Cleaner" },
      workExperience: [{ role: "Cleaner", tasks: ["cleaning"], achievement: "Kept assigned rooms tidy", achievementMode: "manual" }],
      writingPreferences: { objectiveMode: "manual", objectiveText: "My own objective", profileMode: "manual", profileText: "My own profile" },
    });
    const cv = candidateFactsToPdfData(facts);
    expect(cv.objective).toBe("My own objective");
    expect(cv.profile).toBe("My own profile");
    expect(cv.achievements).toContain("Cleaning");
    expect(cv.achievements).not.toContain("Laundry");
    expect(cv.achievements).toContain("Kept assigned rooms tidy");
  });

  it("uses the template fallback when AI is unavailable", async () => {
    const oldKey = process.env.GEMINI_API_KEY;
    const oldEnabled = process.env.GEMINI_CV_POLISH_ENABLED;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_CV_POLISH_ENABLED;
    try {
      const facts = cleanCandidateFacts({ goal: { targetRoleId: "cashier", targetRole: "Cashier" }, writingPreferences: { aiConsent: true } });
      const cv = await writeCandidateCv(facts);
      expect(cv.objective).toContain("Cashier");
      expect(cv.profile).toBe("");
    } finally {
      if (oldKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey;
      if (oldEnabled === undefined) delete process.env.GEMINI_CV_POLISH_ENABLED; else process.env.GEMINI_CV_POLISH_ENABLED = oldEnabled;
    }
  });

  it("renders selectable, multi-page PDF text without invalid dates", () => {
    const facts = cleanCandidateFacts({
      goal: { targetRoleId: "general_hand", targetRole: "General hand" },
      candidate: { fullName: "Alex Candidate", phone: "+263771234567" },
      workExperience: [{ role: "General hand", employer: "Example employer", startDate: "2022", tasks: ["loading_unloading"] }],
      education: [{ title: "O Level", institution: "Example school", startYear: "2018" }],
      practicalTasks: ["manual_assistance"],
      writingPreferences: { objectiveMode: "write_for_me" },
    });
    const pdfData = candidateFactsToPdfData(facts);
    pdfData.achievements = Array.from({ length: 100 }, (_, index) => `- Confirmed task ${index + 1} with clear, readable details`).join("\n");
    const pdf = buildCvPdf(pdfData).toString("ascii");
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("Alex Candidate");
    expect(pdf).toContain("2022");
    expect(pdf).not.toContain("NaN");
    expect((pdf.match(/\/Type \/Page\b/g) || []).length).toBeGreaterThan(1);
  });
});
