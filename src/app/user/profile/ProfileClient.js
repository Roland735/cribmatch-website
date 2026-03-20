"use client";

import { useEffect, useState, useCallback } from "react";
import { signOut } from "next-auth/react";

export default function ProfileClient() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState("account");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [name, setName] = useState("");
  const [agentProfile, setAgentProfile] = useState(null);
  const [agentRateHistory, setAgentRateHistory] = useState([]);
  const [agentVerificationHistory, setAgentVerificationHistory] = useState([]);
  const [agentRate, setAgentRate] = useState("");
  const [agentFixedFee, setAgentFixedFee] = useState("");
  const [agentFeePreference, setAgentFeePreference] = useState("both");
  const [agentFullLegalName, setAgentFullLegalName] = useState("");
  const [agentContactEmail, setAgentContactEmail] = useState("");
  const [agentContactPhone, setAgentContactPhone] = useState("");
  const [agentGovernmentIdNumber, setAgentGovernmentIdNumber] = useState("");
  const [agentAgencyLicenseNumber, setAgentAgencyLicenseNumber] = useState("");
  const [agentAgencyName, setAgentAgencyName] = useState("");
  const [agentAgencyAffiliationProof, setAgentAgencyAffiliationProof] = useState("");
  const [agentAlternatePhone, setAgentAlternatePhone] = useState("");
  const [agentOfficeAddress, setAgentOfficeAddress] = useState("");
  const [agentCity, setAgentCity] = useState("");
  const [agentYearsExperience, setAgentYearsExperience] = useState("");
  const [agentAreasServed, setAgentAreasServed] = useState("");
  const [agentSpecializations, setAgentSpecializations] = useState("");
  const [agentBio, setAgentBio] = useState("");
  const [agentPreferredContactMethod, setAgentPreferredContactMethod] = useState("phone");
  const [agentWebsiteUrl, setAgentWebsiteUrl] = useState("");
  const [agentNote, setAgentNote] = useState("");
  const [agentSaving, setAgentSaving] = useState(false);

  const loadProfile = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await fetch("/api/user/profile", {
        method: "GET",
        headers: { "content-type": "application/json" },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not load your profile.");
      }
      setUser(payload.user);
      setName(payload.user?.name || "");
    } catch (err) {
      console.error("Load Profile Error:", err);
      setError(err?.message || "Could not load your profile.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const loadAgentProfile = useCallback(async () => {
    try {
      const response = await fetch("/api/agent/profile", {
        method: "GET",
        headers: { "content-type": "application/json" },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return;
      const profile = payload?.profile || null;
      setAgentProfile(profile);
      setAgentRateHistory(Array.isArray(payload?.rateHistory) ? payload.rateHistory : []);
      setAgentVerificationHistory(
        Array.isArray(payload?.verificationHistory) ? payload.verificationHistory : [],
      );
      setAgentRate(
        typeof profile?.commissionRatePercent === "number"
          ? String(profile.commissionRatePercent)
          : "",
      );
      setAgentFixedFee(typeof profile?.fixedFee === "number" ? String(profile.fixedFee) : "");
      setAgentFeePreference(
        typeof profile?.feePreference === "string" ? profile.feePreference : "both",
      );
      setAgentFullLegalName(profile?.fullLegalName || "");
      setAgentContactEmail(profile?.contactEmail || "");
      setAgentContactPhone(profile?.contactPhone || "");
      setAgentGovernmentIdNumber(profile?.governmentIdNumber || "");
      setAgentAgencyLicenseNumber(profile?.agencyLicenseNumber || "");
      setAgentAgencyName(profile?.agencyName || "");
      setAgentAgencyAffiliationProof(profile?.agencyAffiliationProof || "");
      setAgentAlternatePhone(profile?.alternatePhone || "");
      setAgentOfficeAddress(profile?.officeAddress || "");
      setAgentCity(profile?.city || "");
      setAgentYearsExperience(
        typeof profile?.yearsExperience === "number" ? String(profile.yearsExperience) : "",
      );
      setAgentAreasServed(
        Array.isArray(profile?.areasServed) ? profile.areasServed.join(", ") : "",
      );
      setAgentSpecializations(
        Array.isArray(profile?.specializations) ? profile.specializations.join(", ") : "",
      );
      setAgentBio(profile?.bio || "");
      setAgentPreferredContactMethod(profile?.preferredContactMethod || "phone");
      setAgentWebsiteUrl(profile?.websiteUrl || "");
    } catch {
    }
  }, []);

  useEffect(() => {
    if (user?.role === "agent") {
      loadAgentProfile();
    }
  }, [loadAgentProfile, user?.role]);

  const handleUpdate = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not update your profile.");
      }
      setUser(payload.user);
      setSuccess("Profile updated successfully.");
    } catch (err) {
      console.error("Update Profile Error:", err);
      setError(err?.message || "Could not update your profile.");
    } finally {
      setSaving(false);
    }
  };

  const handleAgentRateUpdate = async (e) => {
    e.preventDefault();
    const hasRate = agentRate !== "";
    const hasFixed = agentFixedFee !== "";
    if (!hasRate && !hasFixed) {
      setError("Provide either commission rate or fixed fee.");
      return;
    }
    const rateValue = hasRate ? Number(agentRate) : null;
    const fixedFeeValue = hasFixed ? Number(agentFixedFee) : null;
    if (hasRate && (!Number.isFinite(rateValue) || rateValue < 0 || rateValue > 100)) {
      setError("Commission rate must be between 0 and 100.");
      return;
    }
    if (hasFixed && (!Number.isFinite(fixedFeeValue) || fixedFeeValue < 0)) {
      setError("Fixed fee must be a non-negative number.");
      return;
    }
    if (agentFeePreference === "commission" && !hasRate) {
      setError("Commission model requires commission rate.");
      return;
    }
    if (agentFeePreference === "fixed" && !hasFixed) {
      setError("Fixed model requires fixed fee.");
      return;
    }
    if (agentWebsiteUrl && !/^https?:\/\/.+/i.test(agentWebsiteUrl.trim())) {
      setError("Website URL must start with http:// or https://.");
      return;
    }
    if (
      !agentGovernmentIdNumber.trim() ||
      !agentAgencyLicenseNumber.trim() ||
      !agentAgencyName.trim() ||
      !agentAgencyAffiliationProof.trim()
    ) {
      setError("Gov ID, license, agency, and affiliation proof are required.");
      return;
    }

    setAgentSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/agent/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullLegalName: agentFullLegalName,
          contactEmail: agentContactEmail,
          contactPhone: agentContactPhone,
          governmentIdNumber: agentGovernmentIdNumber,
          agencyLicenseNumber: agentAgencyLicenseNumber,
          agencyName: agentAgencyName,
          agencyAffiliationProof: agentAgencyAffiliationProof,
          alternatePhone: agentAlternatePhone,
          officeAddress: agentOfficeAddress,
          city: agentCity,
          yearsExperience:
            agentYearsExperience === "" ? null : Number(agentYearsExperience),
          areasServed: agentAreasServed,
          specializations: agentSpecializations,
          bio: agentBio,
          preferredContactMethod: agentPreferredContactMethod,
          websiteUrl: agentWebsiteUrl,
          feePreference: agentFeePreference,
          commissionRatePercent: rateValue,
          fixedFee: fixedFeeValue,
          note: agentNote,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not update rates.");
      }
      setSuccess("Rates updated. Profile moved to Pending Re-approval.");
      setAgentNote("");
      await loadAgentProfile();
    } catch (agentError) {
      setError(agentError?.message || "Could not update rates.");
    } finally {
      setAgentSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-slate-400">Loading profile…</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {user?.role === "agent" ? (
        <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-slate-950/40 p-1">
          <button
            type="button"
            onClick={() => setActiveTab("account")}
            className={
              activeTab === "account"
                ? "rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white"
                : "rounded-xl px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-white/5"
            }
          >
            Account
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("agent")}
            className={
              activeTab === "agent"
                ? "rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white"
                : "rounded-xl px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-white/5"
            }
          >
            Agent Profile
          </button>
        </div>
      ) : null}

      {activeTab === "account" ? (
        <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
          <form onSubmit={handleUpdate} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-200" htmlFor="phoneNumber">
                Phone Number
              </label>
              <input
                id="phoneNumber"
                value={user?.phoneNumber || ""}
                disabled
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/40 px-4 py-2 text-sm text-slate-500 outline-none cursor-not-allowed"
              />
              <p className="mt-1 text-[10px] text-slate-500 uppercase tracking-wide">Verified via WhatsApp</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200" htmlFor="name">
                Full Name
              </label>
              <input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
                placeholder="Your name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200" htmlFor="role">
                Account Type
              </label>
              <div className="mt-2 inline-flex items-center rounded-full bg-emerald-400/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-400 ring-1 ring-inset ring-emerald-400/20">
                {user?.role || "user"}
              </div>
            </div>

            {error ? (
              <p className="text-sm font-medium text-rose-200">{error}</p>
            ) : null}

            {success ? (
              <p className="text-sm font-medium text-emerald-200">{success}</p>
            ) : null}

            <div className="flex items-center justify-end pt-4">
              <button
                type="submit"
                disabled={saving || name === user?.name}
                className="rounded-full bg-emerald-400 px-6 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {user?.role === "agent" && activeTab === "agent" ? (
        <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
          <form onSubmit={handleAgentRateUpdate} className="space-y-4">
            <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-200">
              Verification status: {agentProfile?.verificationStatus || "none"}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200" htmlFor="agentFullLegalName">
                Full legal name
              </label>
              <input
                id="agentFullLegalName"
                value={agentFullLegalName}
                onChange={(event) => setAgentFullLegalName(event.target.value)}
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200" htmlFor="agentContactEmail">
                Contact email
              </label>
              <input
                id="agentContactEmail"
                type="email"
                value={agentContactEmail}
                onChange={(event) => setAgentContactEmail(event.target.value)}
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200" htmlFor="agentContactPhone">
                Contact phone
              </label>
              <input
                id="agentContactPhone"
                value={agentContactPhone}
                onChange={(event) => setAgentContactPhone(event.target.value)}
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200" htmlFor="agentGovernmentIdNumber">
                Government ID
              </label>
              <input
                id="agentGovernmentIdNumber"
                value={agentGovernmentIdNumber}
                onChange={(event) => setAgentGovernmentIdNumber(event.target.value)}
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200" htmlFor="agentAgencyLicenseNumber">
                Agency license number
              </label>
              <input
                id="agentAgencyLicenseNumber"
                value={agentAgencyLicenseNumber}
                onChange={(event) => setAgentAgencyLicenseNumber(event.target.value)}
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200" htmlFor="agentAgencyName">
                Agency name
              </label>
              <input
                id="agentAgencyName"
                value={agentAgencyName}
                onChange={(event) => setAgentAgencyName(event.target.value)}
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200" htmlFor="agentAgencyAffiliationProof">
                Affiliation proof
              </label>
              <input
                id="agentAgencyAffiliationProof"
                value={agentAgencyAffiliationProof}
                onChange={(event) => setAgentAgencyAffiliationProof(event.target.value)}
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200" htmlFor="agentAlternatePhone">
                Alternate phone
              </label>
              <input
                id="agentAlternatePhone"
                value={agentAlternatePhone}
                onChange={(event) => setAgentAlternatePhone(event.target.value)}
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200" htmlFor="agentOfficeAddress">
                Office address
              </label>
              <input
                id="agentOfficeAddress"
                value={agentOfficeAddress}
                onChange={(event) => setAgentOfficeAddress(event.target.value)}
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200" htmlFor="agentCity">
                City
              </label>
              <input
                id="agentCity"
                value={agentCity}
                onChange={(event) => setAgentCity(event.target.value)}
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200" htmlFor="agentYearsExperience">
                Years of experience
              </label>
              <input
                id="agentYearsExperience"
                type="number"
                value={agentYearsExperience}
                onChange={(event) => setAgentYearsExperience(event.target.value)}
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200" htmlFor="agentAreasServed">
                Areas served (comma-separated)
              </label>
              <input
                id="agentAreasServed"
                value={agentAreasServed}
                onChange={(event) => setAgentAreasServed(event.target.value)}
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200" htmlFor="agentSpecializations">
                Specializations (comma-separated)
              </label>
              <input
                id="agentSpecializations"
                value={agentSpecializations}
                onChange={(event) => setAgentSpecializations(event.target.value)}
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200" htmlFor="agentBio">
                Bio
              </label>
              <input
                id="agentBio"
                value={agentBio}
                onChange={(event) => setAgentBio(event.target.value)}
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200" htmlFor="agentPreferredContactMethod">
                Preferred contact method
              </label>
              <select
                id="agentPreferredContactMethod"
                value={agentPreferredContactMethod}
                onChange={(event) => setAgentPreferredContactMethod(event.target.value)}
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-slate-50 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              >
                <option value="phone">Phone</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="email">Email</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200" htmlFor="agentWebsiteUrl">
                Website URL
              </label>
              <input
                id="agentWebsiteUrl"
                value={agentWebsiteUrl}
                onChange={(event) => setAgentWebsiteUrl(event.target.value)}
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200" htmlFor="agentFeePreference">
                Fee model
              </label>
              <select
                id="agentFeePreference"
                value={agentFeePreference}
                onChange={(event) => setAgentFeePreference(event.target.value)}
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-slate-50 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              >
                <option value="commission">Commission only</option>
                <option value="fixed">Fixed fee only</option>
                <option value="both">Commission or fixed fee</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200" htmlFor="agentRate">
                Commission rate (%)
              </label>
              <input
                id="agentRate"
                type="number"
                value={agentRate}
                onChange={(event) => setAgentRate(event.target.value)}
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200" htmlFor="agentFixedFee">
                Fixed fee (USD)
              </label>
              <input
                id="agentFixedFee"
                type="number"
                value={agentFixedFee}
                onChange={(event) => setAgentFixedFee(event.target.value)}
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200" htmlFor="agentNote">
                Change note
              </label>
              <input
                id="agentNote"
                value={agentNote}
                onChange={(event) => setAgentNote(event.target.value)}
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
                placeholder="Reason for rate update"
              />
            </div>

            <button
              type="submit"
              disabled={agentSaving}
              className="rounded-full bg-emerald-400 px-6 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {agentSaving ? "Saving..." : "Save rates"}
            </button>
          </form>

          <div className="mt-6 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Rate change history
            </p>
            {agentRateHistory.length ? (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-left text-xs text-slate-200">
                  <thead>
                    <tr className="text-slate-400">
                      <th className="pr-4 pb-2">When</th>
                      <th className="pr-4 pb-2">Rate</th>
                      <th className="pr-4 pb-2">Fixed fee</th>
                      <th className="pb-2">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agentRateHistory.slice().reverse().map((row, index) => (
                      <tr key={`agent-rate-history-${index}`} className="border-t border-white/5">
                        <td className="pr-4 py-2">{row.changedAt ? new Date(row.changedAt).toLocaleString() : "N/A"}</td>
                        <td className="pr-4 py-2">{typeof row.commissionRatePercent === "number" ? `${row.commissionRatePercent}%` : "N/A"}</td>
                        <td className="pr-4 py-2">{typeof row.fixedFee === "number" ? `USD ${row.fixedFee}` : "N/A"}</td>
                        <td className="py-2">{row.note || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-400">No rate changes yet.</p>
            )}
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Verification history
            </p>
            {agentVerificationHistory.length ? (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-left text-xs text-slate-200">
                  <thead>
                    <tr className="text-slate-400">
                      <th className="pr-4 pb-2">When</th>
                      <th className="pr-4 pb-2">From</th>
                      <th className="pr-4 pb-2">To</th>
                      <th className="pb-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agentVerificationHistory.slice().reverse().map((row, index) => (
                      <tr key={`agent-verification-history-${index}`} className="border-t border-white/5">
                        <td className="pr-4 py-2">{row.changedAt ? new Date(row.changedAt).toLocaleString() : "N/A"}</td>
                        <td className="pr-4 py-2">{row.fromStatus || "N/A"}</td>
                        <td className="pr-4 py-2">{row.toStatus || "N/A"}</td>
                        <td className="py-2">{row.reason || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-400">No verification history yet.</p>
            )}
          </div>
        </div>
      ) : null}

      <div className="rounded-3xl border border-rose-400/10 bg-rose-400/5 p-6">
        <h3 className="text-sm font-semibold text-white">Sign out</h3>
        <p className="mt-2 text-sm text-slate-400">Sign out of your account on this device.</p>
        <button
          onClick={() => signOut({ callbackUrl: "/" })}
          className="mt-6 rounded-full border border-rose-400/30 bg-rose-400/10 px-6 py-2.5 text-sm font-semibold text-rose-100 transition hover:bg-rose-400/20"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
