"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ListingUnlockPaymentClient({ listingId }) {
  const router = useRouter();
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
      setTransactionId(String(payload?.transactionId || ""));
      setNotice(
        payload?.instructions ||
        "USSD push sent. Approve on EcoCash, then tap check payment to unlock contact details.",
      );
    } catch {
      setError("Could not start payment right now.");
    } finally {
      setLoadingStart(false);
    }
  }

  async function verifyPayment() {
    if (!transactionId) return;
    setError("");
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
        setError(payload?.error || "Could not verify payment.");
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
        return;
      }
      setNotice("Payment still pending. Complete EcoCash prompt, then check again.");
    } catch {
      setError("Could not verify payment right now.");
    } finally {
      setLoadingVerify(false);
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4">
        <p className="text-sm leading-relaxed text-amber-200">
          You haven&apos;t unlocked this listing yet. Pay USD 1 via Paynow EcoCash to view phone, WhatsApp, and email.
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
        {loadingStart ? "Sending EcoCash prompt..." : "Unlock details — $1.00"}
      </button>

      {transactionId ? (
        <button
          type="button"
          onClick={verifyPayment}
          disabled={loadingVerify}
          className="inline-flex w-full items-center justify-center rounded-xl border border-emerald-400/30 px-3 py-2 font-semibold text-emerald-100 transition hover:bg-emerald-400/10 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loadingVerify ? "Checking payment..." : "I approved on EcoCash — unlock now"}
        </button>
      ) : null}

      {notice ? <p className="text-xs text-emerald-100/90">{notice}</p> : null}
      {error ? <p className="text-xs text-rose-200">{error}</p> : null}
      <p className="text-[10px] text-center text-slate-300/80">
        One-time payment for lifetime access to this listing&apos;s details.
      </p>
    </div>
  );
}
