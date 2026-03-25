"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

function formatDate(value, withTime = false) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return withTime
    ? parsed.toLocaleString()
    : parsed.toLocaleDateString();
}

function formatMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "$0.00";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function toDateInput(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

export default function AdminAccountingClient() {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [listingId, setListingId] = useState("");
  const [data, setData] = useState({
    summary: {
      totalSales: 0,
      totalRevenueUsd: 0,
      firstSaleAt: null,
      lastSaleAt: null,
    },
    topListings: [],
    listingFilters: [],
    selectedListing: null,
    sales: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadAccounting = useCallback(
    async (nextFilters = {}) => {
      const currentFrom = nextFilters.fromDate !== undefined ? nextFilters.fromDate : fromDate;
      const currentTo = nextFilters.toDate !== undefined ? nextFilters.toDate : toDate;
      const currentListingId = nextFilters.listingId !== undefined ? nextFilters.listingId : listingId;
      const params = new URLSearchParams();
      if (currentFrom) params.set("from", currentFrom);
      if (currentTo) params.set("to", currentTo);
      if (currentListingId) params.set("listingId", currentListingId);
      params.set("limit", "150");

      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/admin/accounting?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Could not load accounting data.");
        }
        setData({
          summary: payload?.summary || {
            totalSales: 0,
            totalRevenueUsd: 0,
            firstSaleAt: null,
            lastSaleAt: null,
          },
          topListings: Array.isArray(payload?.topListings) ? payload.topListings : [],
          listingFilters: Array.isArray(payload?.listingFilters) ? payload.listingFilters : [],
          selectedListing: payload?.selectedListing || null,
          sales: Array.isArray(payload?.sales) ? payload.sales : [],
        });
      } catch (loadError) {
        setError(loadError?.message || "Could not load accounting data.");
      } finally {
        setLoading(false);
      }
    },
    [fromDate, toDate, listingId],
  );

  useEffect(() => {
    loadAccounting();
  }, [loadAccounting]);

  const highestSelling = useMemo(() => {
    if (!Array.isArray(data?.topListings) || data.topListings.length === 0) return null;
    return data.topListings[0];
  }, [data?.topListings]);

  const listingOptions = useMemo(() => {
    const options = Array.isArray(data?.listingFilters) ? data.listingFilters : [];
    return options.filter((row) => row?.listingId);
  }, [data?.listingFilters]);

  async function handleApplyFilters(event) {
    event.preventDefault();
    await loadAccounting();
  }

  async function handleClearFilters() {
    setFromDate("");
    setToDate("");
    setListingId("");
    await loadAccounting({ fromDate: "", toDate: "", listingId: "" });
  }

  async function handleChooseTopListing(id) {
    const next = String(id || "").trim();
    setListingId(next);
    await loadAccounting({ listingId: next });
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleApplyFilters} className="rounded-3xl border border-white/10 bg-slate-900/40 p-5">
        <div className="grid gap-4 lg:grid-cols-4">
          <div>
            <label htmlFor="salesFromDate" className="block text-sm font-medium text-slate-200">
              From date
            </label>
            <input
              id="salesFromDate"
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
              className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
            />
          </div>
          <div>
            <label htmlFor="salesToDate" className="block text-sm font-medium text-slate-200">
              To date
            </label>
            <input
              id="salesToDate"
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
              className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
            />
          </div>
          <div>
            <label htmlFor="listingFilter" className="block text-sm font-medium text-slate-200">
              Listing filter
            </label>
            <select
              id="listingFilter"
              value={listingId}
              onChange={(event) => setListingId(event.target.value)}
              className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
            >
              <option value="">All sold listings</option>
              {listingOptions.map((item) => (
                <option key={item.listingId} value={item.listingId}>
                  {item.listingTitle} ({item.salesCount})
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300 disabled:opacity-60"
              disabled={loading}
            >
              {loading ? "Loading…" : "Apply filters"}
            </button>
            <button
              type="button"
              onClick={handleClearFilters}
              className="rounded-full border border-white/15 px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:border-white/30 hover:bg-white/5"
              disabled={loading}
            >
              Clear
            </button>
          </div>
        </div>
        {error ? <p className="mt-3 text-sm font-medium text-rose-200">{error}</p> : null}
      </form>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-5">
          <p className="text-sm text-slate-400">Total sales</p>
          <p className="mt-2 text-3xl font-bold text-white">{Number(data?.summary?.totalSales || 0)}</p>
          <p className="mt-2 text-xs text-slate-500">
            {formatDate(data?.summary?.firstSaleAt)} to {formatDate(data?.summary?.lastSaleAt)}
          </p>
        </div>
        <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-5">
          <p className="text-sm text-slate-400">Sales revenue</p>
          <p className="mt-2 text-3xl font-bold text-emerald-300">{formatMoney(data?.summary?.totalRevenueUsd)}</p>
          <p className="mt-2 text-xs text-slate-500">Based on paid transactions</p>
        </div>
        <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-5">
          <p className="text-sm text-slate-400">Highest selling listing</p>
          {highestSelling ? (
            <>
              <p className="mt-2 text-base font-semibold text-white">{highestSelling.listingTitle}</p>
              <p className="mt-1 text-sm text-slate-300">
                {highestSelling.salesCount} sales · {formatMoney(highestSelling.totalRevenueUsd)}
              </p>
              <button
                type="button"
                onClick={() => handleChooseTopListing(highestSelling.listingId)}
                className="mt-3 rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-white/30 hover:bg-white/5"
              >
                View this listing
              </button>
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-500">No paid sales yet.</p>
          )}
        </div>
      </div>

      {data?.selectedListing ? (
        <section className="rounded-3xl border border-white/10 bg-slate-900/40 p-5">
          <h2 className="text-base font-semibold text-white">Selected listing details</h2>
          <p className="mt-1 text-sm text-slate-300">{data.selectedListing.title}</p>
          <div className="mt-4 grid gap-3 text-sm text-slate-200 sm:grid-cols-2 lg:grid-cols-4">
            <p>Listing code: <span className="font-medium text-white">{data.selectedListing.shortId || "—"}</span></p>
            <p>Status: <span className="font-medium text-white">{data.selectedListing.status || "—"}</span></p>
            <p>Approved: <span className="font-medium text-white">{data.selectedListing.approved ? "Yes" : "No"}</span></p>
            <p>Type: <span className="font-medium text-white">{data.selectedListing.propertyType || "—"}</span></p>
            <p>Location: <span className="font-medium text-white">{[data.selectedListing.suburb, data.selectedListing.city].filter(Boolean).join(", ") || "—"}</span></p>
            <p>Lister: <span className="font-medium text-white">{data.selectedListing.listerPhoneNumber || "—"}</span></p>
            <p>Asking rent: <span className="font-medium text-white">{formatMoney(data.selectedListing.pricePerMonth)}</span></p>
            <p>Total sales: <span className="font-medium text-white">{Number(data.selectedListing.salesCount || 0)}</span></p>
            <p>Total revenue: <span className="font-medium text-white">{formatMoney(data.selectedListing.totalRevenueUsd)}</span></p>
            <p>First sale: <span className="font-medium text-white">{formatDate(data.selectedListing.firstSaleAt)}</span></p>
            <p>Last sale: <span className="font-medium text-white">{formatDate(data.selectedListing.lastSaleAt)}</span></p>
          </div>
        </section>
      ) : null}

      <section className="rounded-3xl border border-white/10 bg-slate-900/40 p-5">
        <h2 className="text-base font-semibold text-white">Top selling listings</h2>
        <p className="mt-1 text-xs text-slate-400">Ranked by number of paid sales and revenue.</p>
        <div className="mt-4 max-h-[400px] overflow-auto rounded-2xl border border-white/10">
          {loading ? (
            <p className="p-4 text-sm text-slate-400">Loading top listings…</p>
          ) : !Array.isArray(data?.topListings) || data.topListings.length === 0 ? (
            <p className="p-4 text-sm text-slate-400">No sold listings found for this range.</p>
          ) : (
            <table className="w-full min-w-[760px] text-left text-xs text-slate-200">
              <thead className="bg-slate-950/70 text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Listing</th>
                  <th className="px-3 py-2 font-medium">Code</th>
                  <th className="px-3 py-2 font-medium">Sales</th>
                  <th className="px-3 py-2 font-medium">Revenue</th>
                  <th className="px-3 py-2 font-medium">Last sale</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.topListings.map((item) => (
                  <tr key={item.listingId} className="border-t border-white/5">
                    <td className="px-3 py-2">
                      <p className="font-medium text-white">{item.listingTitle || "Listing"}</p>
                      <p className="text-[11px] text-slate-400">{[item.suburb, item.city].filter(Boolean).join(", ") || "—"}</p>
                    </td>
                    <td className="px-3 py-2">{item.listingCode || "—"}</td>
                    <td className="px-3 py-2">{Number(item.salesCount || 0)}</td>
                    <td className="px-3 py-2">{formatMoney(item.totalRevenueUsd)}</td>
                    <td className="px-3 py-2">{formatDate(item.lastSaleAt)}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => handleChooseTopListing(item.listingId)}
                        className="rounded-full border border-white/15 px-3 py-1 text-[11px] font-semibold text-slate-100 transition hover:border-white/30 hover:bg-white/5"
                      >
                        Select
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-slate-900/40 p-5">
        <h2 className="text-base font-semibold text-white">
          {listingId ? "Sales for selected listing" : "Recent sales"}
        </h2>
        <p className="mt-1 text-xs text-slate-400">Transaction date, payer details, reference, and amount.</p>
        <div className="mt-4 max-h-[460px] overflow-auto rounded-2xl border border-white/10">
          {loading ? (
            <p className="p-4 text-sm text-slate-400">Loading sales…</p>
          ) : !Array.isArray(data?.sales) || data.sales.length === 0 ? (
            <p className="p-4 text-sm text-slate-400">No sales found for this filter.</p>
          ) : (
            <table className="w-full min-w-[980px] text-left text-xs text-slate-200">
              <thead className="bg-slate-950/70 text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Sale date</th>
                  <th className="px-3 py-2 font-medium">Listing</th>
                  <th className="px-3 py-2 font-medium">Reference</th>
                  <th className="px-3 py-2 font-medium">Buyer phone</th>
                  <th className="px-3 py-2 font-medium">Payer mobile</th>
                  <th className="px-3 py-2 font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {data.sales.map((sale) => (
                  <tr key={sale.id} className="border-t border-white/5">
                    <td className="px-3 py-2">{formatDate(sale.saleDate, true)}</td>
                    <td className="px-3 py-2">
                      <p className="font-medium text-white">{sale.listingTitle || "Listing"}</p>
                      <p className="text-[11px] text-slate-400">{sale.listingCode || sale.listingId}</p>
                    </td>
                    <td className="px-3 py-2">{sale.reference || "—"}</td>
                    <td className="px-3 py-2">{sale.phone || "—"}</td>
                    <td className="px-3 py-2">{sale.payerMobile || "—"}</td>
                    <td className="px-3 py-2">{formatMoney(sale.amount)}</td>
                    <td className="px-3 py-2">{formatDate(sale.createdAt, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
