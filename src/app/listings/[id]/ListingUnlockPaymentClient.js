"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function ListingUnlockPaymentClient({ listingId }) {
  const router = useRouter();
  const [unlockPriceUsd, setUnlockPriceUsd] = useState(2.5);
  const [payerMobile, setPayerMobile] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [loadingStart, setLoadingStart] = useState(false);
  const [loadingVerify, setLoadingVerify] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function startPayment() {
    setError("");
    setNotice("");
    setLoadingStart(true);
    try {
      const response = await fetch("/api/purchases/unlock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "start",
          listingId,
          payerMobile,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload?.error || "Failed to start EcoCash payment.");
        return;
      }
      if (payload?.alreadyPurchased) {
        setNotice("Already purchased. Unlocking contact details...");
        router.refresh();
        return;
      }
      if (Number.isFinite(Number(payload?.amount))) {
        setUnlockPriceUsd(Number(payload.amount));
      }
      setTransactionId(String(payload?.transactionId || ""));
      setNotice(
        payload?.instructions ||
        "USSD push sent. Approve on EcoCash. We will auto-detect payment and unlock contact details.",
      );
    } catch {
      setError("Could not start payment right now.");
    } finally {
      setLoadingStart(false);
    }
  }

  const verifyPayment = useCallback(async ({ silent = false } = {}) => {
    if (!transactionId) return;
    if (!silent) {
      setError("");
    }
    setLoadingVerify(true);
    try {
      const response = await fetch("/api/purchases/unlock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "verify",
          listingId,
          transactionId,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (!silent) {
          setError(payload?.error || "Could not verify payment.");
        }
        return;
      }
      if (payload?.paid) {
        setNotice("Payment successful. Unlocking contact details...");
        router.refresh();
        return;
      }
      const status = String(payload?.status || "pending_confirmation");
      if (/failed|cancel/i.test(status)) {
        setError(`Payment ${status}. Enter number and retry.`);
        setNotice("");
        setTransactionId("");
        return;
      }
      setNotice("Payment still pending. Complete EcoCash USSD prompt. We are checking automatically.");
    } catch {
      if (!silent) {
        setError("Could not verify payment right now.");
      }
    } finally {
      setLoadingVerify(false);
    }
  }, [listingId, router, transactionId]);

  useEffect(() => {
    let active = true;
    const loadPricing = async () => {
      try {
        const response = await fetch("/api/pricing");
        const payload = await response.json().catch(() => ({}));
        if (!active || !response.ok) return;
        const amount = Number(payload?.pricing?.contactUnlockPriceUsd);
        if (Number.isFinite(amount)) {
          setUnlockPriceUsd(amount);
        }
      } catch {
      }
    };
    loadPricing();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!transactionId) return undefined;
    let active = true;

    const run = async () => {
      if (!active) return;
      await verifyPayment({ silent: true });
    };

    run();
    const intervalId = setInterval(run, 3500);
    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [transactionId, verifyPayment]);

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4">
        <p className="text-sm leading-relaxed text-amber-200">
          You haven&apos;t unlocked this listing yet. Pay USD {unlockPriceUsd.toFixed(2)} via Paynow EcoCash to view phone, WhatsApp, and email.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-emerald-200" htmlFor="payerMobile">
          EcoCash number
        </label>
        <input
          id="payerMobile"
          value={payerMobile}
          onChange={(event) => setPayerMobile(event.target.value)}
          placeholder="0771234567 or 263771234567"
          className="block w-full rounded-xl border border-emerald-400/30 bg-slate-950/50 px-3 py-2 text-sm text-emerald-50 outline-none transition placeholder:text-emerald-100/40 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-400/30"
        />
      </div>

      <button
        type="button"
        onClick={startPayment}
        disabled={loadingStart}
        className="inline-flex w-full items-center justify-center rounded-xl bg-emerald-400 px-3 py-2 font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {loadingStart ? "Sending EcoCash prompt..." : `Unlock details — $${unlockPriceUsd.toFixed(2)}`}
      </button>

      {transactionId ? (
        <p className="text-xs text-emerald-100/90">
          {loadingVerify
            ? "Checking payment status..."
            : "Waiting for payment confirmation... this updates automatically."}
        </p>
      ) : null}

      {notice ? <p className="text-xs text-emerald-100/90">{notice}</p> : null}
      {error ? <p className="text-xs text-rose-200">{error}</p> : null}
      <p className="text-[10px] text-center text-slate-300/80">
        One-time payment for lifetime access to this listing&apos;s details.
      </p>
    </div>
  );
}
