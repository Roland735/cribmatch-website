"use client";

import { useEffect, useMemo, useState } from "react";

function formatDate(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString();
}

export default function AdminContactsClient() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [adminContactNumber, setAdminContactNumber] = useState("");
  const [users, setUsers] = useState([]);
  const [listings, setListings] = useState([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    async function loadData() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/admin/contacts", {
          method: "GET",
          headers: { "content-type": "application/json" },
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Could not load contacts.");
        }
        if (!active) return;
        setAdminContactNumber(payload?.adminContactNumber || "");
        setUsers(Array.isArray(payload?.users) ? payload.users : []);
        setListings(Array.isArray(payload?.listings) ? payload.listings : []);
      } catch (loadError) {
        if (!active) return;
        setError(loadError?.message || "Could not load contacts.");
      } finally {
        if (active) setLoading(false);
      }
    }
    loadData();
    return () => {
      active = false;
    };
  }, []);

  const filteredUsers = useMemo(() => {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return users;
    return users.filter((item) => {
      const name = String(item?.name || "").toLowerCase();
      const phone = String(item?.phoneNumber || "").toLowerCase();
      const role = String(item?.role || "").toLowerCase();
      return name.includes(q) || phone.includes(q) || role.includes(q);
    });
  }, [query, users]);

  const filteredListings = useMemo(() => {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return listings;
    return listings.filter((item) => {
      const title = String(item?.listingTitle || "").toLowerCase();
      const city = String(item?.city || "").toLowerCase();
      const suburb = String(item?.suburb || "").toLowerCase();
      const email = String(item?.email || "").toLowerCase();
      const phones = Array.isArray(item?.phones) ? item.phones.join(" ").toLowerCase() : "";
      return (
        title.includes(q) ||
        city.includes(q) ||
        suburb.includes(q) ||
        email.includes(q) ||
        phones.includes(q)
      );
    });
  }, [query, listings]);

  async function handleSave(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/admin/contacts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ adminContactNumber }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not save your contact number.");
      }
      setAdminContactNumber(payload?.adminContactNumber || "");
      setSuccess("Admin contact number saved.");
    } catch (saveError) {
      setError(saveError?.message || "Could not save your contact number.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-5">
        <form className="grid gap-4 sm:grid-cols-[1fr_auto]" onSubmit={handleSave}>
          <div>
            <label className="block text-sm font-medium text-slate-200" htmlFor="adminContactNumber">
              Your admin contact number
            </label>
            <input
              id="adminContactNumber"
              name="adminContactNumber"
              type="tel"
              value={adminContactNumber}
              onChange={(event) => setAdminContactNumber(event.target.value)}
              placeholder="+263771234567"
              className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              disabled={saving}
              aria-describedby="admin-contact-help"
            />
            <p id="admin-contact-help" className="mt-2 text-xs text-slate-400">
              This number is saved to your admin profile for contact operations.
            </p>
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={saving}
              className="rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save number"}
            </button>
          </div>
        </form>
        {error ? <p className="mt-3 text-sm font-medium text-rose-200">{error}</p> : null}
        {success ? <p className="mt-3 text-sm font-medium text-emerald-200">{success}</p> : null}
      </div>

      <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-5">
        <label className="block text-sm font-medium text-slate-200" htmlFor="contactsQuery">
          Search contacts
        </label>
        <input
          id="contactsQuery"
          name="contactsQuery"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, phone, role, suburb, or listing title"
          className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-3xl border border-white/10 bg-slate-900/40 p-5">
          <h2 className="text-base font-semibold text-white">User contacts</h2>
          <p className="mt-1 text-xs text-slate-400">
            {loading ? "Loading user contacts…" : `${filteredUsers.length} records`}
          </p>
          <div className="mt-4 max-h-[420px] overflow-auto rounded-2xl border border-white/10">
            {loading ? (
              <p className="p-4 text-sm text-slate-400">Loading…</p>
            ) : filteredUsers.length === 0 ? (
              <p className="p-4 text-sm text-slate-400">No user contacts found.</p>
            ) : (
              <table className="w-full min-w-[460px] text-left text-xs text-slate-200">
                <thead className="bg-slate-950/70 text-slate-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Phone</th>
                    <th className="px-3 py-2 font-medium">Role</th>
                    <th className="px-3 py-2 font-medium">Added</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((item, index) => (
                    <tr key={`${item.phoneNumber}-${index}`} className="border-t border-white/5">
                      <td className="px-3 py-2">{item.name || "—"}</td>
                      <td className="px-3 py-2">{item.phoneNumber || "—"}</td>
                      <td className="px-3 py-2 capitalize">{item.role || "user"}</td>
                      <td className="px-3 py-2">{formatDate(item.createdAt) || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/40 p-5">
          <h2 className="text-base font-semibold text-white">Listing contacts</h2>
          <p className="mt-1 text-xs text-slate-400">
            {loading ? "Loading listing contacts…" : `${filteredListings.length} records`}
          </p>
          <div className="mt-4 max-h-[420px] overflow-auto rounded-2xl border border-white/10">
            {loading ? (
              <p className="p-4 text-sm text-slate-400">Loading…</p>
            ) : filteredListings.length === 0 ? (
              <p className="p-4 text-sm text-slate-400">No listing contacts found.</p>
            ) : (
              <table className="w-full min-w-[520px] text-left text-xs text-slate-200">
                <thead className="bg-slate-950/70 text-slate-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Listing</th>
                    <th className="px-3 py-2 font-medium">Location</th>
                    <th className="px-3 py-2 font-medium">Phones</th>
                    <th className="px-3 py-2 font-medium">Email</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredListings.map((item, index) => (
                    <tr key={`${item.listingTitle}-${index}`} className="border-t border-white/5">
                      <td className="px-3 py-2">{item.listingTitle || "Untitled listing"}</td>
                      <td className="px-3 py-2">{[item.suburb, item.city].filter(Boolean).join(", ") || "—"}</td>
                      <td className="px-3 py-2">{Array.isArray(item.phones) && item.phones.length ? item.phones.join(" / ") : "—"}</td>
                      <td className="px-3 py-2">{item.email || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
