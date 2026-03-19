"use client";

import { useMemo, useState } from "react";

const INITIAL_FORM = {
  fullLegalName: "",
  contactEmail: "",
  contactPhone: "",
  governmentIdNumber: "",
  agencyLicenseNumber: "",
  agencyAffiliationProof: "",
  agencyName: "",
  commissionRatePercent: "",
  fixedFee: "",
};

export default function AgentRegistrationClient() {
  const [form, setForm] = useState(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const formError = useMemo(() => {
    if (!form.fullLegalName.trim()) return "Full legal name is required.";
    if (!form.contactEmail.trim()) return "Contact email is required.";
    if (!form.contactPhone.trim()) return "Contact phone is required.";
    if (!form.governmentIdNumber.trim()) return "Government-issued ID is required.";
    if (!form.agencyLicenseNumber.trim()) return "Agency license number is required.";
    if (!form.agencyAffiliationProof.trim()) return "Proof of agency affiliation is required.";
    const rate = Number(form.commissionRatePercent);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      return "Commission rate must be between 0 and 100.";
    }
    const fixedFee = Number(form.fixedFee);
    if (!Number.isFinite(fixedFee) || fixedFee < 0) {
      return "Fixed fee must be a non-negative number.";
    }
    return "";
  }, [form]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (formError) return;
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/agents/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          commissionRatePercent: Number(form.commissionRatePercent),
          fixedFee: Number(form.fixedFee),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to submit application");
      }
      setSuccess("Application submitted. Status: Pending Verification.");
    } catch (submitError) {
      setError(submitError?.message || "Failed to submit application.");
    } finally {
      setSubmitting(false);
    }
  }

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-3xl border border-white/10 bg-slate-900/40 p-6 space-y-4">
      <Field
        label="Full legal name"
        value={form.fullLegalName}
        onChange={(value) => updateField("fullLegalName", value)}
      />
      <Field
        label="Contact email"
        type="email"
        value={form.contactEmail}
        onChange={(value) => updateField("contactEmail", value)}
      />
      <Field
        label="Contact phone"
        value={form.contactPhone}
        onChange={(value) => updateField("contactPhone", value)}
      />
      <Field
        label="Government-issued ID"
        value={form.governmentIdNumber}
        onChange={(value) => updateField("governmentIdNumber", value)}
      />
      <Field
        label="Agency license number"
        value={form.agencyLicenseNumber}
        onChange={(value) => updateField("agencyLicenseNumber", value)}
      />
      <Field
        label="Proof of agency affiliation (URL or reference)"
        value={form.agencyAffiliationProof}
        onChange={(value) => updateField("agencyAffiliationProof", value)}
      />
      <Field
        label="Agency name (optional)"
        value={form.agencyName}
        onChange={(value) => updateField("agencyName", value)}
      />
      <Field
        label="Commission rate (%)"
        type="number"
        value={form.commissionRatePercent}
        onChange={(value) => updateField("commissionRatePercent", value)}
      />
      <Field
        label="Fixed fee (USD)"
        type="number"
        value={form.fixedFee}
        onChange={(value) => updateField("fixedFee", value)}
      />

      {error ? <p className="text-sm text-rose-200">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-200">{success}</p> : null}
      {formError ? <p className="text-xs text-amber-200">{formError}</p> : null}

      <button
        type="submit"
        disabled={Boolean(formError) || submitting}
        className="w-full rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Submitting..." : "Submit for Verification"}
      </button>
    </form>
  );
}

function Field({ label, value, onChange, type = "text" }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-200">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
      />
    </div>
  );
}
