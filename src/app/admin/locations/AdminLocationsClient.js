"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

function toSafeString(value) {
  return typeof value === "string" ? value : "";
}

export default function AdminLocationsClient() {
  const [cities, setCities] = useState([]);
  const [suburbs, setSuburbs] = useState([]);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedCityIds, setSelectedCityIds] = useState(new Set());
  const [selectedSuburbIds, setSelectedSuburbIds] = useState(new Set());

  const [newCityName, setNewCityName] = useState("");
  const [editingCityId, setEditingCityId] = useState("");
  const [editingCityName, setEditingCityName] = useState("");

  const [newSuburbName, setNewSuburbName] = useState("");
  const [selectedCityId, setSelectedCityId] = useState("");
  const [editingSuburbId, setEditingSuburbId] = useState("");
  const [editingSuburbName, setEditingSuburbName] = useState("");
  const [editingSuburbCityId, setEditingSuburbCityId] = useState("");

  const cityNameById = useMemo(() => {
    const map = new Map();
    for (const city of cities) {
      map.set(city.city_id, city.city_name);
    }
    return map;
  }, [cities]);

  const suburbsGrouped = useMemo(() => {
    const grouped = new Map();
    for (const suburb of suburbs) {
      const cityId = toSafeString(suburb.city_id);
      if (!grouped.has(cityId)) grouped.set(cityId, []);
      grouped.get(cityId).push(suburb);
    }
    for (const cityId of grouped.keys()) {
      grouped.get(cityId).sort((a, b) =>
        toSafeString(a.suburb_name).localeCompare(toSafeString(b.suburb_name)),
      );
    }
    return grouped;
  }, [suburbs]);

  const loadLocations = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [citiesResponse, suburbsResponse, publicResponse] = await Promise.all([
        fetch("/api/admin/locations/cities", { method: "GET", cache: "no-store" }),
        fetch("/api/admin/locations/suburbs", { method: "GET", cache: "no-store" }),
        fetch("/api/locations", { method: "GET", cache: "no-store" }),
      ]);
      if (!citiesResponse.ok || !suburbsResponse.ok) throw new Error("Failed to load locations");
      const citiesPayload = await citiesResponse.json().catch(() => ({}));
      const suburbsPayload = await suburbsResponse.json().catch(() => ({}));
      const publicPayload = await publicResponse.json().catch(() => ({}));

      const nextCities = Array.isArray(citiesPayload?.cities)
        ? citiesPayload.cities.map((city) => ({
            city_id: toSafeString(city?.city_id),
            city_name: toSafeString(city?.city_name),
            active: city?.active !== false,
          }))
        : [];
      const nextSuburbs = Array.isArray(suburbsPayload?.suburbs)
        ? suburbsPayload.suburbs.map((suburb) => ({
            suburb_id: toSafeString(suburb?.suburb_id),
            suburb_name: toSafeString(suburb?.suburb_name),
            city_id: toSafeString(suburb?.city_id),
            city_name: toSafeString(suburb?.city_name),
            active: suburb?.active !== false,
          }))
        : [];

      setCities(nextCities);
      setSuburbs(nextSuburbs);
      setVersion(Number(publicPayload?.version || 0));
      if (!selectedCityId && nextCities[0]?.city_id) {
        setSelectedCityId(nextCities[0].city_id);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load locations");
    } finally {
      setLoading(false);
    }
  }, [selectedCityId]);

  useEffect(() => {
    loadLocations();
  }, [loadLocations]);

  useEffect(() => {
    const poll = async () => {
      try {
        const response = await fetch("/api/locations", { method: "GET", cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json().catch(() => ({}));
        const nextVersion = Number(payload?.version || 0);
        if (nextVersion > version) {
          await loadLocations();
        }
      } catch {
      }
    };
    const timer = setInterval(poll, 10000);
    return () => clearInterval(timer);
  }, [loadLocations, version]);

  async function createCity(event) {
    event.preventDefault();
    const cityName = newCityName.trim();
    if (!cityName) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/locations/cities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ city_name: cityName, active: true }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(toSafeString(payload?.error) || "Could not create city");
      setNewCityName("");
      await loadLocations();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create city");
    } finally {
      setSaving(false);
    }
  }

  async function updateCity(cityId) {
    const cityName = editingCityName.trim();
    if (!cityName) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/locations/cities/${cityId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ city_name: cityName }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(toSafeString(payload?.error) || "Could not update city");
      setEditingCityId("");
      setEditingCityName("");
      await loadLocations();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Could not update city");
    } finally {
      setSaving(false);
    }
  }

  async function deleteCity(cityId) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/locations/cities/${cityId}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(toSafeString(payload?.error) || "Could not delete city");
      await loadLocations();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete city");
    } finally {
      setSaving(false);
    }
  }

  async function createSuburb(event) {
    event.preventDefault();
    const suburbName = newSuburbName.trim();
    if (!selectedCityId || !suburbName) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/locations/suburbs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ city_id: selectedCityId, suburb_name: suburbName, active: true }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(toSafeString(payload?.error) || "Could not create suburb");
      setNewSuburbName("");
      await loadLocations();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create suburb");
    } finally {
      setSaving(false);
    }
  }

  async function updateSuburb(suburbId) {
    const suburbName = editingSuburbName.trim();
    if (!suburbName || !editingSuburbCityId) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/locations/suburbs/${suburbId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ city_id: editingSuburbCityId, suburb_name: suburbName }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(toSafeString(payload?.error) || "Could not update suburb");
      setEditingSuburbId("");
      setEditingSuburbName("");
      setEditingSuburbCityId("");
      await loadLocations();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Could not update suburb");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSuburb(suburbId) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/locations/suburbs/${suburbId}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(toSafeString(payload?.error) || "Could not delete suburb");
      await loadLocations();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete suburb");
    } finally {
      setSaving(false);
    }
  }

  async function toggleCityActive(cityId, nextActive) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/locations/cities/${cityId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: nextActive }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(toSafeString(payload?.error) || "Could not update city status");
      await loadLocations();
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Could not update city status");
    } finally {
      setSaving(false);
    }
  }

  async function toggleSuburbActive(suburbId, nextActive) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/locations/suburbs/${suburbId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: nextActive }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(toSafeString(payload?.error) || "Could not update suburb status");
      await loadLocations();
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Could not update suburb status");
    } finally {
      setSaving(false);
    }
  }

  async function runBulk(target, action, ids = []) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/locations/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target, action, ids }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(toSafeString(payload?.error) || "Bulk action failed");
      setSelectedCityIds(new Set());
      setSelectedSuburbIds(new Set());
      await loadLocations();
    } catch (bulkError) {
      setError(bulkError instanceof Error ? bulkError.message : "Bulk action failed");
    } finally {
      setSaving(false);
    }
  }

  function toggleCitySelection(cityId) {
    setSelectedCityIds((current) => {
      const next = new Set(current);
      if (next.has(cityId)) next.delete(cityId);
      else next.add(cityId);
      return next;
    });
  }

  function toggleSuburbSelection(suburbId) {
    setSelectedSuburbIds((current) => {
      const next = new Set(current);
      if (next.has(suburbId)) next.delete(suburbId);
      else next.add(suburbId);
      return next;
    });
  }

  const selectedCityList = Array.from(selectedCityIds);
  const selectedSuburbList = Array.from(selectedSuburbIds);
  const activeCitiesCount = cities.filter((city) => city.active !== false).length;
  const activeSuburbsCount = suburbs.filter((suburb) => suburb.active !== false).length;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-2xl border border-white/10 bg-slate-900/50 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Cities</h2>
          <span className="rounded-full bg-emerald-400/20 px-3 py-1 text-xs font-semibold text-emerald-200">
            Version {version || 1}
          </span>
        </div>
        <p className="mb-4 text-xs text-slate-400">
          Active cities: {activeCitiesCount} / {cities.length}
        </p>
        <form onSubmit={createCity} className="mb-4 flex gap-2">
          <input
            value={newCityName}
            onChange={(event) => setNewCityName(event.target.value)}
            placeholder="Add city"
            className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400"
          />
          <button
            type="submit"
            disabled={saving || !newCityName.trim()}
            className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60"
          >
            Add
          </button>
        </form>

        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => runBulk("cities", "activate", selectedCityList)}
            disabled={saving || !selectedCityList.length}
            className="rounded-lg border border-emerald-400/40 px-3 py-1 text-xs font-semibold text-emerald-200 disabled:opacity-60"
          >
            Activate selected
          </button>
          <button
            type="button"
            onClick={() => runBulk("cities", "deactivate", selectedCityList)}
            disabled={saving || !selectedCityList.length}
            className="rounded-lg border border-amber-400/40 px-3 py-1 text-xs font-semibold text-amber-200 disabled:opacity-60"
          >
            Deactivate selected
          </button>
          <button
            type="button"
            onClick={() => runBulk("cities", "delete", selectedCityList)}
            disabled={saving || !selectedCityList.length}
            className="rounded-lg border border-rose-400/40 px-3 py-1 text-xs font-semibold text-rose-300 disabled:opacity-60"
          >
            Delete selected
          </button>
          <button
            type="button"
            onClick={() => runBulk("cities", "harare_only", [])}
            disabled={saving}
            className="rounded-lg border border-violet-400/40 px-3 py-1 text-xs font-semibold text-violet-200 disabled:opacity-60"
          >
            Keep Harare only
          </button>
        </div>

        <div className="space-y-2">
          {cities.map((city) => (
            <div key={city.city_id} className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
              {editingCityId === city.city_id ? (
                <div className="flex gap-2">
                  <input
                    value={editingCityName}
                    onChange={(event) => setEditingCityName(event.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1 text-sm text-white outline-none focus:border-emerald-400"
                  />
                  <button
                    type="button"
                    onClick={() => updateCity(city.city_id)}
                    disabled={saving || !editingCityName.trim()}
                    className="rounded-lg bg-emerald-400 px-3 py-1 text-xs font-semibold text-slate-950 disabled:opacity-60"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingCityId("");
                      setEditingCityName("");
                    }}
                    className="rounded-lg border border-white/15 px-3 py-1 text-xs font-semibold text-slate-200"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selectedCityIds.has(city.city_id)}
                      onChange={() => toggleCitySelection(city.city_id)}
                    />
                    <div>
                      <p className="text-sm font-semibold text-white">{city.city_name}</p>
                      <p className="text-xs text-slate-400">{city.city_id}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${city.active !== false ? "bg-emerald-500/20 text-emerald-200" : "bg-amber-500/20 text-amber-200"}`}
                    >
                      {city.active !== false ? "Active" : "Inactive"}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleCityActive(city.city_id, city.active === false)}
                      disabled={saving}
                      className="rounded-lg border border-white/15 px-3 py-1 text-xs font-semibold text-slate-200"
                    >
                      {city.active !== false ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCityId(city.city_id);
                        setEditingCityName(city.city_name);
                      }}
                      className="rounded-lg border border-white/15 px-3 py-1 text-xs font-semibold text-slate-200"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteCity(city.city_id)}
                      disabled={saving}
                      className="rounded-lg border border-rose-400/40 px-3 py-1 text-xs font-semibold text-rose-300 disabled:opacity-60"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-slate-900/50 p-5">
        <h2 className="mb-4 text-lg font-semibold text-white">Suburbs</h2>
        <p className="mb-4 text-xs text-slate-400">
          Active suburbs: {activeSuburbsCount} / {suburbs.length}
        </p>
        <form onSubmit={createSuburb} className="mb-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <select
            value={selectedCityId}
            onChange={(event) => setSelectedCityId(event.target.value)}
            className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400"
          >
            <option value="">Select city</option>
            {cities.map((city) => (
              <option key={city.city_id} value={city.city_id}>
                {city.city_name}
              </option>
            ))}
          </select>
          <input
            value={newSuburbName}
            onChange={(event) => setNewSuburbName(event.target.value)}
            placeholder="Add suburb"
            className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400"
          />
          <button
            type="submit"
            disabled={saving || !selectedCityId || !newSuburbName.trim()}
            className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60"
          >
            Add
          </button>
        </form>

        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => runBulk("suburbs", "activate", selectedSuburbList)}
            disabled={saving || !selectedSuburbList.length}
            className="rounded-lg border border-emerald-400/40 px-3 py-1 text-xs font-semibold text-emerald-200 disabled:opacity-60"
          >
            Activate selected
          </button>
          <button
            type="button"
            onClick={() => runBulk("suburbs", "deactivate", selectedSuburbList)}
            disabled={saving || !selectedSuburbList.length}
            className="rounded-lg border border-amber-400/40 px-3 py-1 text-xs font-semibold text-amber-200 disabled:opacity-60"
          >
            Deactivate selected
          </button>
          <button
            type="button"
            onClick={() => runBulk("suburbs", "delete", selectedSuburbList)}
            disabled={saving || !selectedSuburbList.length}
            className="rounded-lg border border-rose-400/40 px-3 py-1 text-xs font-semibold text-rose-300 disabled:opacity-60"
          >
            Delete selected
          </button>
        </div>

        <div className="space-y-3">
          {cities.map((city) => {
            const citySuburbs = suburbsGrouped.get(city.city_id) || [];
            return (
              <div key={city.city_id} className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
                <p className="mb-2 text-sm font-semibold text-white">{city.city_name}</p>
                <div className="space-y-2">
                  {citySuburbs.map((suburb) => (
                    <div key={suburb.suburb_id} className="flex items-center justify-between gap-2">
                      {editingSuburbId === suburb.suburb_id ? (
                        <>
                          <input
                            value={editingSuburbName}
                            onChange={(event) => setEditingSuburbName(event.target.value)}
                            className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1 text-sm text-white outline-none focus:border-emerald-400"
                          />
                          <select
                            value={editingSuburbCityId}
                            onChange={(event) => setEditingSuburbCityId(event.target.value)}
                            className="rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1 text-sm text-white outline-none focus:border-emerald-400"
                          >
                            {cities.map((item) => (
                              <option key={item.city_id} value={item.city_id}>
                                {item.city_name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => updateSuburb(suburb.suburb_id)}
                            disabled={saving || !editingSuburbName.trim() || !editingSuburbCityId}
                            className="rounded-lg bg-emerald-400 px-3 py-1 text-xs font-semibold text-slate-950 disabled:opacity-60"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingSuburbId("");
                              setEditingSuburbName("");
                              setEditingSuburbCityId("");
                            }}
                            className="rounded-lg border border-white/15 px-3 py-1 text-xs font-semibold text-slate-200"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={selectedSuburbIds.has(suburb.suburb_id)}
                              onChange={() => toggleSuburbSelection(suburb.suburb_id)}
                            />
                            <div>
                              <p className="text-sm text-slate-100">{suburb.suburb_name}</p>
                              <p className="text-xs text-slate-500">
                                {cityNameById.get(suburb.city_id) || suburb.city_id}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${suburb.active !== false ? "bg-emerald-500/20 text-emerald-200" : "bg-amber-500/20 text-amber-200"}`}
                            >
                              {suburb.active !== false ? "Active" : "Inactive"}
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleSuburbActive(suburb.suburb_id, suburb.active === false)}
                              disabled={saving}
                              className="rounded-lg border border-white/15 px-3 py-1 text-xs font-semibold text-slate-200"
                            >
                              {suburb.active !== false ? "Deactivate" : "Activate"}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSuburbId(suburb.suburb_id);
                                setEditingSuburbName(suburb.suburb_name);
                                setEditingSuburbCityId(suburb.city_id);
                              }}
                              className="rounded-lg border border-white/15 px-3 py-1 text-xs font-semibold text-slate-200"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteSuburb(suburb.suburb_id)}
                              disabled={saving}
                              className="rounded-lg border border-rose-400/40 px-3 py-1 text-xs font-semibold text-rose-300 disabled:opacity-60"
                            >
                              Delete
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                  {!citySuburbs.length ? <p className="text-xs text-slate-500">No suburbs yet.</p> : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {error ? (
        <div className="lg:col-span-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}
      {loading ? (
        <div className="lg:col-span-2 rounded-xl border border-white/10 bg-slate-900/40 px-4 py-3 text-sm text-slate-300">
          Loading locations...
        </div>
      ) : null}
      {!loading && !cities.length ? (
        <div className="lg:col-span-2 rounded-xl border border-white/10 bg-slate-900/40 px-4 py-3 text-sm text-slate-300">
          No cities available yet. Add your first city to start.
        </div>
      ) : null}
    </div>
  );
}
