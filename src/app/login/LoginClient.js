"use client";

import { signIn } from "next-auth/react";
import { useMemo, useState } from "react";
import PhoneNumberInput from "@/app/PhoneNumberInput";

export default function LoginClient({ callbackUrl = "/dashboard" }) {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [phonePassword, setPhonePassword] = useState("");

  const [registerName, setRegisterName] = useState("");
  const [registerPhoneNumber, setRegisterPhoneNumber] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerCode, setRegisterCode] = useState("");
  const [registerOtpSent, setRegisterOtpSent] = useState(false);

  const [firstPhoneNumber, setFirstPhoneNumber] = useState("");
  const [firstName, setFirstName] = useState("");
  const [firstPassword, setFirstPassword] = useState("");
  const [firstCode, setFirstCode] = useState("");
  const [firstOtpSent, setFirstOtpSent] = useState(false);

  const [resetPhoneNumber, setResetPhoneNumber] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetOtpSent, setResetOtpSent] = useState(false);

  const [mode, setMode] = useState("signin");
  const [status, setStatus] = useState("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const showSeedHints = process.env.NODE_ENV === "development";

  const disabled = useMemo(() => status === "loading", [status]);
  const safeCallbackUrl = useMemo(() => {
    const raw = typeof callbackUrl === "string" ? callbackUrl : "";
    return raw.startsWith("/") ? raw : "/dashboard";
  }, [callbackUrl]);

  function resetMessages() {
    setErrorMessage("");
    setSuccessMessage("");
  }

  async function sendOtp(phoneNumberValue, purpose) {
    const response = await fetch("/api/auth/whatsapp-otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumber: phoneNumberValue, purpose }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || "Could not send verification code.");
    }
  }

  async function completeOtp(payload) {
    const response = await fetch("/api/auth/whatsapp-otp/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || "Verification failed.");
    }
  }

  async function signInAfterVerification(phoneValue, passwordValue) {
    const signInResponse = await signIn("phone", {
      phoneNumber: phoneValue,
      password: passwordValue,
      redirect: false,
      callbackUrl: safeCallbackUrl,
    });
    if (signInResponse?.error) {
      throw new Error("Verified, but sign-in failed. Please sign in manually.");
    }
    window.location.assign(signInResponse?.url || "/dashboard");
  }

  async function handlePhoneSignIn(event) {
    event.preventDefault();
    setStatus("loading");
    resetMessages();
    const trimmedPhone = String(phoneNumber || "").trim();

    try {
      const statusResponse = await fetch("/api/auth/password-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phoneNumber: trimmedPhone }),
      });
      const statusPayload = await statusResponse.json().catch(() => ({}));
      if (statusResponse.ok && statusPayload?.requiresPasswordSetup) {
        setFirstPhoneNumber(trimmedPhone);
        setFirstCode("");
        setFirstOtpSent(false);
        setMode("first");
        setErrorMessage("You need to set up your web password first. Use First web login.");
        setStatus("idle");
        return;
      }
    } catch { }

    const response = await signIn("phone", {
      phoneNumber,
      password: phonePassword,
      redirect: false,
      callbackUrl: safeCallbackUrl,
    });

    if (response?.error) {
      if (phonePassword.includes("@")) {
        setErrorMessage("Password is not your email. Use your password to sign in.");
      } else {
        setErrorMessage("Invalid phone number or password. If this is your first web login, use First web login.");
      }
      setStatus("idle");
      return;
    }

    window.location.assign(response?.url || "/dashboard");
  }

  async function handleSendRegisterOtp(event) {
    event.preventDefault();
    await requestRegisterOtp();
  }

  async function requestRegisterOtp() {
    setStatus("loading");
    resetMessages();
    try {
      await sendOtp(registerPhoneNumber, "signup");
      setRegisterOtpSent(true);
      setSuccessMessage("Verification code sent to your WhatsApp number.");
    } catch (error) {
      setErrorMessage(error?.message || "Could not send verification code.");
    } finally {
      setStatus("idle");
    }
  }

  async function handleCompleteRegister(event) {
    event.preventDefault();
    setStatus("loading");
    resetMessages();
    try {
      await completeOtp({
        purpose: "signup",
        phoneNumber: registerPhoneNumber,
        code: registerCode,
        password: registerPassword,
        name: registerName,
      });
      await signInAfterVerification(registerPhoneNumber, registerPassword);
    } catch (error) {
      setErrorMessage(error?.message || "Could not create account.");
      setStatus("idle");
    }
  }

  async function handleSendFirstOtp(event) {
    event.preventDefault();
    await requestFirstOtp();
  }

  async function requestFirstOtp() {
    setStatus("loading");
    resetMessages();
    try {
      await sendOtp(firstPhoneNumber, "first_web_login");
      setFirstOtpSent(true);
      setSuccessMessage("Verification code sent to your WhatsApp number.");
    } catch (error) {
      setErrorMessage(error?.message || "Could not send verification code.");
    } finally {
      setStatus("idle");
    }
  }

  async function handleCompleteFirst(event) {
    event.preventDefault();
    setStatus("loading");
    resetMessages();
    try {
      await completeOtp({
        purpose: "first_web_login",
        phoneNumber: firstPhoneNumber,
        code: firstCode,
        password: firstPassword,
        name: firstName,
      });
      await signInAfterVerification(firstPhoneNumber, firstPassword);
    } catch (error) {
      setErrorMessage(error?.message || "Could not complete first web login.");
      setStatus("idle");
    }
  }

  async function handleSendResetOtp(event) {
    event.preventDefault();
    await requestResetOtp();
  }

  async function requestResetOtp() {
    setStatus("loading");
    resetMessages();
    try {
      await sendOtp(resetPhoneNumber, "reset_password");
      setResetOtpSent(true);
      setSuccessMessage("Verification code sent to your WhatsApp number.");
    } catch (error) {
      setErrorMessage(error?.message || "Could not send verification code.");
    } finally {
      setStatus("idle");
    }
  }

  async function handleCompleteReset(event) {
    event.preventDefault();
    setStatus("loading");
    resetMessages();
    try {
      await completeOtp({
        purpose: "reset_password",
        phoneNumber: resetPhoneNumber,
        code: resetCode,
        password: resetPassword,
      });
      await signInAfterVerification(resetPhoneNumber, resetPassword);
    } catch (error) {
      setErrorMessage(error?.message || "Could not reset password.");
      setStatus("idle");
    }
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-white/10 bg-slate-950/40 p-1 md:grid-cols-4" role="tablist" aria-label="Authentication modes">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "signin"}
          onClick={() => {
            setMode("signin");
            resetMessages();
          }}
          disabled={disabled}
          className={
            mode === "signin"
              ? "rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white"
              : "rounded-xl px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-white/5"
          }
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "register"}
          onClick={() => {
            setMode("register");
            resetMessages();
          }}
          disabled={disabled}
          className={
            mode === "register"
              ? "rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white"
              : "rounded-xl px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-white/5"
          }
        >
          Create
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "first"}
          onClick={() => {
            setMode("first");
            resetMessages();
          }}
          disabled={disabled}
          className={
            mode === "first"
              ? "rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white"
              : "rounded-xl px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-white/5"
          }
        >
          First login
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "reset"}
          onClick={() => {
            setMode("reset");
            resetMessages();
          }}
          disabled={disabled}
          className={
            mode === "reset"
              ? "rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white"
              : "rounded-xl px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-white/5"
          }
        >
          Reset
        </button>
      </div>

      {mode === "signin" ? (
        <form className="space-y-3" onSubmit={handlePhoneSignIn}>
          <PhoneNumberInput
            id="phoneNumber"
            name="phoneNumber"
            label="Phone number"
            value={phoneNumber}
            onChange={setPhoneNumber}
            disabled={disabled}
          />
          <div>
            <label className="block text-sm font-medium text-slate-200" htmlFor="phonePassword">
              Password
            </label>
            <input
              id="phonePassword"
              name="phonePassword"
              type="password"
              autoComplete="current-password"
              value={phonePassword}
              onChange={(e) => setPhonePassword(e.target.value)}
              className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              placeholder="••••••••"
              disabled={disabled}
            />
            {showSeedHints ? (
              <p className="mt-2 text-xs text-slate-400">
                Seeded passwords: admin12345 (admin), agent12345 (agent), user12345 (user).
              </p>
            ) : null}
          </div>
          {errorMessage ? <p className="text-sm font-medium text-rose-200">{errorMessage}</p> : null}
          <button
            type="submit"
            disabled={disabled}
            className="inline-flex w-full items-center justify-center rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Sign in
          </button>
        </form>
      ) : null}

      {mode === "register" ? (
        <form className="space-y-3" onSubmit={registerOtpSent ? handleCompleteRegister : handleSendRegisterOtp}>
          <div>
            <label className="block text-sm font-medium text-slate-200" htmlFor="registerName">
              Name (optional)
            </label>
            <input
              id="registerName"
              name="registerName"
              type="text"
              value={registerName}
              onChange={(e) => setRegisterName(e.target.value)}
              className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              placeholder="Your name"
              disabled={disabled}
            />
          </div>
          <PhoneNumberInput
            id="registerPhoneNumber"
            name="registerPhoneNumber"
            label="Phone number"
            value={registerPhoneNumber}
            onChange={(value) => {
              setRegisterPhoneNumber(value);
              if (registerOtpSent) {
                setRegisterOtpSent(false);
                setRegisterCode("");
                resetMessages();
              }
            }}
            disabled={disabled}
          />
          <div>
            <label className="block text-sm font-medium text-slate-200" htmlFor="registerPassword">
              Password
            </label>
            <input
              id="registerPassword"
              name="registerPassword"
              type="password"
              autoComplete="new-password"
              value={registerPassword}
              onChange={(e) => setRegisterPassword(e.target.value)}
              className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              placeholder="At least 8 characters"
              disabled={disabled}
            />
          </div>
          {registerOtpSent ? (
            <div>
              <label className="block text-sm font-medium text-slate-200" htmlFor="registerCode">
                Verification code from WhatsApp
              </label>
              <input
                id="registerCode"
                name="registerCode"
                type="text"
                inputMode="numeric"
                value={registerCode}
                onChange={(e) => setRegisterCode(e.target.value)}
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
                placeholder="123456"
                disabled={disabled}
              />
            </div>
          ) : null}

          {errorMessage ? <p className="text-sm font-medium text-rose-200">{errorMessage}</p> : null}
          {successMessage ? <p className="text-sm font-medium text-emerald-200">{successMessage}</p> : null}
          {registerOtpSent ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={requestRegisterOtp}
                disabled={disabled}
                className="rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-white/30 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Request new code
              </button>
              <button
                type="button"
                onClick={() => {
                  setRegisterOtpSent(false);
                  setRegisterCode("");
                  resetMessages();
                }}
                disabled={disabled}
                className="rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-white/30 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Change number
              </button>
            </div>
          ) : null}
          <button
            type="submit"
            disabled={disabled}
            className="inline-flex w-full items-center justify-center rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {registerOtpSent ? "Verify and create account" : "Send code to WhatsApp"}
          </button>
        </form>
      ) : null}

      {mode === "first" ? (
        <form className="space-y-3" onSubmit={firstOtpSent ? handleCompleteFirst : handleSendFirstOtp}>
          <PhoneNumberInput
            id="firstPhoneNumber"
            name="firstPhoneNumber"
            label="WhatsApp phone number"
            value={firstPhoneNumber}
            onChange={(value) => {
              setFirstPhoneNumber(value);
              if (firstOtpSent) {
                setFirstOtpSent(false);
                setFirstCode("");
                resetMessages();
              }
            }}
            disabled={disabled}
          />
          <div>
            <label className="block text-sm font-medium text-slate-200" htmlFor="firstName">
              Name (optional)
            </label>
            <input
              id="firstName"
              name="firstName"
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              placeholder="Your name"
              disabled={disabled}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-200" htmlFor="firstPassword">
              Set your web password
            </label>
            <input
              id="firstPassword"
              name="firstPassword"
              type="password"
              autoComplete="new-password"
              value={firstPassword}
              onChange={(e) => setFirstPassword(e.target.value)}
              className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              placeholder="At least 8 characters"
              disabled={disabled}
            />
          </div>
          {firstOtpSent ? (
            <div>
              <label className="block text-sm font-medium text-slate-200" htmlFor="firstCode">
                Verification code from WhatsApp
              </label>
              <input
                id="firstCode"
                name="firstCode"
                type="text"
                inputMode="numeric"
                value={firstCode}
                onChange={(e) => setFirstCode(e.target.value)}
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
                placeholder="123456"
                disabled={disabled}
              />
            </div>
          ) : null}

          {errorMessage ? <p className="text-sm font-medium text-rose-200">{errorMessage}</p> : null}
          {successMessage ? <p className="text-sm font-medium text-emerald-200">{successMessage}</p> : null}
          {firstOtpSent ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={requestFirstOtp}
                disabled={disabled}
                className="rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-white/30 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Request new code
              </button>
              <button
                type="button"
                onClick={() => {
                  setFirstOtpSent(false);
                  setFirstCode("");
                  resetMessages();
                }}
                disabled={disabled}
                className="rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-white/30 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Change number
              </button>
            </div>
          ) : null}
          <button
            type="submit"
            disabled={disabled}
            className="inline-flex w-full items-center justify-center rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {firstOtpSent ? "Verify and continue" : "Send code to WhatsApp"}
          </button>
        </form>
      ) : null}

      {mode === "reset" ? (
        <form className="space-y-3" onSubmit={resetOtpSent ? handleCompleteReset : handleSendResetOtp}>
          <PhoneNumberInput
            id="resetPhoneNumber"
            name="resetPhoneNumber"
            label="Registered phone number"
            value={resetPhoneNumber}
            onChange={(value) => {
              setResetPhoneNumber(value);
              if (resetOtpSent) {
                setResetOtpSent(false);
                setResetCode("");
                resetMessages();
              }
            }}
            disabled={disabled}
          />
          <div>
            <label className="block text-sm font-medium text-slate-200" htmlFor="resetPassword">
              New password
            </label>
            <input
              id="resetPassword"
              name="resetPassword"
              type="password"
              autoComplete="new-password"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              placeholder="At least 8 characters"
              disabled={disabled}
            />
          </div>
          {resetOtpSent ? (
            <div>
              <label className="block text-sm font-medium text-slate-200" htmlFor="resetCode">
                Verification code from WhatsApp
              </label>
              <input
                id="resetCode"
                name="resetCode"
                type="text"
                inputMode="numeric"
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value)}
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
                placeholder="123456"
                disabled={disabled}
              />
            </div>
          ) : null}

          {errorMessage ? <p className="text-sm font-medium text-rose-200">{errorMessage}</p> : null}
          {successMessage ? <p className="text-sm font-medium text-emerald-200">{successMessage}</p> : null}
          {resetOtpSent ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={requestResetOtp}
                disabled={disabled}
                className="rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-white/30 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Request new code
              </button>
              <button
                type="button"
                onClick={() => {
                  setResetOtpSent(false);
                  setResetCode("");
                  resetMessages();
                }}
                disabled={disabled}
                className="rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-white/30 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Change number
              </button>
            </div>
          ) : null}
          <button
            type="submit"
            disabled={disabled}
            className="inline-flex w-full items-center justify-center rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {resetOtpSent ? "Verify and reset password" : "Send code to WhatsApp"}
          </button>
        </form>
      ) : null}

      <p className="text-xs text-slate-400">
        WhatsApp verification is web-only.
      </p>
    </div>
  );
}
