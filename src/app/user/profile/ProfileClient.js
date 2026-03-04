"use client";

import { useEffect, useState, useCallback } from "react";
import { signOut } from "next-auth/react";

export default function ProfileClient() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [name, setName] = useState("");

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
        throw new Error(payload?.error || "Failed to load profile");
      }
      setUser(payload.user);
      setName(payload.user?.name || "");
    } catch (err) {
      console.error("Load Profile Error:", err);
      setError(err?.message || "Failed to load profile");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

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
        throw new Error(payload?.error || "Failed to update profile");
      }
      setUser(payload.user);
      setSuccess("Profile updated successfully!");
    } catch (err) {
      console.error("Update Profile Error:", err);
      setError(err?.message || "Failed to update profile");
    } finally {
      setSaving(false);
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

      <div className="rounded-3xl border border-rose-400/10 bg-rose-400/5 p-6">
        <h3 className="text-sm font-semibold text-white">Sign Out</h3>
        <p className="mt-2 text-sm text-slate-400">Log out of your account on this device.</p>
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
