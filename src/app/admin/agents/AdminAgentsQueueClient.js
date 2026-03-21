"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";

export default function AdminAgentsQueueClient() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [reasonById, setReasonById] = useState({});
  const [savingId, setSavingId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const loadQueue = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await fetch("/api/admin/agents?status=all");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load agent queue");
      }
      setAgents(Array.isArray(payload?.agents) ? payload.agents : []);
    } catch (loadError) {
      setError(loadError?.message || "Failed to load queue");
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  async function applyStatus(agentId, status) {
    const reason = (reasonById[agentId] || "").trim();
    if (!reason) {
      setActionError("Please provide a reason before changing status.");
      return;
    }
    setActionError("");
    setSavingId(agentId);
    try {
      const response = await fetch(`/api/admin/agents/${encodeURIComponent(agentId)}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, reason }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to update status");
      }
      await loadQueue();
    } catch (statusError) {
      setActionError(statusError?.message || "Failed to update status.");
    } finally {
      setSavingId("");
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-300">Loading pending applications...</p>;
  }

  if (error) {
    return <p className="text-sm text-rose-200">{error}</p>;
  }

  if (!agents.length) {
    return (
      <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
        <p className="text-sm text-slate-200">No pending agent applications.</p>
      </div>
    );
  }

  const query = searchQuery.trim().toLowerCase();
  const matchesQuery = (agent) => {
    if (!query) return true;
    const haystack = [
      agent?.id,
      agent?.name,
      agent?.fullLegalName,
      agent?.contactEmail,
      agent?.contactPhone,
      agent?.agencyName,
      agent?.governmentIdNumber,
      agent?.agencyLicenseNumber,
    ]
      .map((value) => (typeof value === "string" ? value.toLowerCase() : ""))
      .join(" ");
    return haystack.includes(query);
  };

  const pendingAgents = agents.filter(
    (agent) =>
      matchesQuery(agent) &&
      agent?.verificationStatus === "pending_verification" ||
      (matchesQuery(agent) && agent?.verificationStatus === "pending_reapproval"),
  );
  const verifiedAgents = agents.filter(
    (agent) => matchesQuery(agent) && agent?.verificationStatus === "verified",
  );

  return (
    <div className="space-y-4">
      {actionError ? <p className="text-sm text-rose-200">{actionError}</p> : null}
      <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-4">
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
          Search agents
        </label>
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Name, phone, agency, email, or ID"
          className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
        />
      </div>
      {!pendingAgents.length ? (
        <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
          <p className="text-sm text-slate-200">
            {query ? "No pending applications match your search." : "No pending agent applications."}
          </p>
        </div>
      ) : null}
      {pendingAgents.map((agent) => (
        <article
          key={agent.id}
          className="rounded-3xl border border-white/10 bg-slate-900/40 p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">{agent.fullLegalName || agent.name || agent.id}</h2>
              <p className="text-xs text-slate-400">{agent.id}</p>
            </div>
            <span className="rounded-full bg-amber-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-200 ring-1 ring-inset ring-amber-400/30">
              Pending Verification
            </span>
          </div>

          <div className="mt-4 grid gap-2 text-sm text-slate-200 sm:grid-cols-2">
            <p>Email: {agent.contactEmail || "N/A"}</p>
            <p>Phone: {agent.contactPhone || "N/A"}</p>
            <p>Gov ID: {agent.governmentIdNumber || "N/A"}</p>
            <p>License: {agent.agencyLicenseNumber || "N/A"}</p>
            <p>Agency: {agent.agencyName || "N/A"}</p>
            <p>Affiliation proof: {agent.agencyAffiliationProof || "N/A"}</p>
            <p>Commission: {typeof agent.commissionRatePercent === "number" ? `${agent.commissionRatePercent}%` : "N/A"}</p>
            <p>Fixed fee: {typeof agent.fixedFee === "number" ? `USD ${agent.fixedFee}` : "N/A"}</p>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Government ID image
              </p>
              {agent.governmentIdImageUrl ? (
                <a
                  href={agent.governmentIdImageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 block"
                >
                  <Image
                    src={agent.governmentIdImageUrl}
                    alt={`${agent.fullLegalName || agent.id} government ID`}
                    width={640}
                    height={320}
                    unoptimized
                    className="h-40 w-full rounded-xl object-cover ring-1 ring-white/10"
                  />
                </a>
              ) : (
                <p className="mt-3 text-xs text-slate-400">No image uploaded.</p>
              )}
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Profile image
              </p>
              {agent.profileImageUrl ? (
                <a
                  href={agent.profileImageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 block"
                >
                  <Image
                    src={agent.profileImageUrl}
                    alt={`${agent.fullLegalName || agent.id} profile`}
                    width={640}
                    height={320}
                    unoptimized
                    className="h-40 w-full rounded-xl object-cover ring-1 ring-white/10"
                  />
                </a>
              ) : (
                <p className="mt-3 text-xs text-slate-400">No image uploaded.</p>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Rate change audit
            </p>
            {Array.isArray(agent.rateHistory) && agent.rateHistory.length ? (
              <div className="mt-2 overflow-x-auto">
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
                    {agent.rateHistory.slice().reverse().slice(0, 6).map((row, index) => (
                      <tr key={`${agent.id}-rate-${index}`} className="border-t border-white/5">
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

          <div className="mt-4">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
              Status change reason
            </label>
            <textarea
              value={reasonById[agent.id] || ""}
              onChange={(event) =>
                setReasonById((current) => ({ ...current, [agent.id]: event.target.value }))
              }
              rows={3}
              className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              placeholder="Reason for status decision"
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => applyStatus(agent.id, "verified")}
              disabled={savingId === agent.id}
              className="rounded-full bg-emerald-400 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Verify
            </button>
            <button
              type="button"
              onClick={() => applyStatus(agent.id, "rejected")}
              disabled={savingId === agent.id}
              className="rounded-full border border-rose-400/40 bg-rose-400/10 px-4 py-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Reject
            </button>
          </div>
        </article>
      ))}
      {verifiedAgents.length ? (
        <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/5 p-6">
          <p className="text-sm font-semibold text-emerald-100">
            Verified agents
          </p>
          <p className="mt-1 text-xs text-emerald-100/90">
            Use unapprove to move a verified agent back to pending review.
          </p>
          <div className="mt-4 space-y-3">
            {verifiedAgents.map((agent) => (
              <article
                key={`${agent.id}-verified`}
                className="rounded-2xl border border-white/10 bg-slate-900/40 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      {agent.fullLegalName || agent.name || agent.id}
                    </h3>
                    <p className="text-xs text-slate-400">{agent.id}</p>
                  </div>
                  <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-200 ring-1 ring-inset ring-emerald-400/30">
                    Verified
                  </span>
                </div>
                <div className="mt-3 grid gap-2 text-sm text-slate-200 sm:grid-cols-2">
                  <p>Email: {agent.contactEmail || "N/A"}</p>
                  <p>Phone: {agent.contactPhone || "N/A"}</p>
                  <p>Agency: {agent.agencyName || "N/A"}</p>
                  <p>Commission: {typeof agent.commissionRatePercent === "number" ? `${agent.commissionRatePercent}%` : "N/A"}</p>
                </div>
                <div className="mt-3">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Unapprove reason
                  </label>
                  <textarea
                    value={reasonById[agent.id] || ""}
                    onChange={(event) =>
                      setReasonById((current) => ({ ...current, [agent.id]: event.target.value }))
                    }
                    rows={2}
                    className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
                    placeholder="Reason for unapproving this agent"
                  />
                </div>
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => applyStatus(agent.id, "pending_reapproval")}
                    disabled={savingId === agent.id}
                    className="rounded-full border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-xs font-semibold text-amber-100 transition hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Unapprove
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : null}
      {!verifiedAgents.length && query ? (
        <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
          <p className="text-sm text-slate-200">No verified agents match your search.</p>
        </div>
      ) : null}
    </div>
  );
}
