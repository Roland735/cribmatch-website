"use client";

import { useMemo, useState } from "react";

function formatMoney(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  })
    .format(value)
    .replace("US$", "$");
}

export default function PriceBreakdownModal({
  pricePerMonth,
  deposit,
  listerType = "direct_landlord",
  agentRate = null,
  agentFixedFee = null,
}) {
  const [open, setOpen] = useState(false);
  const rateLabel = useMemo(() => {
    if (listerType !== "agent" || typeof agentRate !== "number") return "N/A";
    return `${agentRate}%`;
  }, [agentRate, listerType]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:border-white/30 hover:bg-white/5"
      >
        View price breakdown
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900 p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-white">Price breakdown</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-white/30 hover:bg-white/5"
              >
                Close
              </button>
            </div>

            <div className="mt-5 space-y-3 text-sm text-slate-200">
              <div className="flex items-center justify-between">
                <span>Monthly rent</span>
                <span className="font-semibold">{formatMoney(pricePerMonth)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Deposit</span>
                <span className="font-semibold">{formatMoney(deposit)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Listing type</span>
                <span className="font-semibold">
                  {listerType === "agent" ? "Agent Listing" : "Direct Landlord"}
                </span>
              </div>
              {listerType === "agent" ? (
                <>
                  <div className="flex items-center justify-between">
                    <span>Agent fee rate</span>
                    <span className="font-semibold">{rateLabel}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Fixed fee</span>
                    <span className="font-semibold">{formatMoney(agentFixedFee)}</span>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
