"use client";

import { signIn } from "next-auth/react";
import { useMemo, useState } from "react";

export default function LoginClient() {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [phonePassword, setPhonePassword] = useState("");
  const [registerName, setRegisterName] = useState("");
  const [registerPhoneNumber, setRegisterPhoneNumber] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [mode, setMode] = useState("signin");
  const [status, setStatus] = useState("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const showSeedHints = process.env.NODE_ENV === "development";

  const disabled = useMemo(() => {
    return status === "loading";
  }, [status]);

  async function handlePhoneSignIn(event) {
    event.preventDefault();
    setStatus("loading");
    setErrorMessage("");

    const response = await signIn("phone", {
      phoneNumber,
      password: phonePassword,
      redirect: false,
      callbackUrl: "/dashboard",
    });

    if (response?.error) {
      if (phonePassword.includes("@")) {
        setErrorMessage("Password is not your email. Use your password to sign in.");
      } else {
        setErrorMessage("Invalid phone number or password.");
      }
      setStatus("idle");
      return;
    }

    window.location.assign(response?.url || "/dashboard");
  }

  async function handleRegister(event) {
    event.preventDefault();
    setStatus("loading");
    setErrorMessage("");

    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: registerName,
        phoneNumber: registerPhoneNumber,
        password: registerPassword,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      setErrorMessage(data?.error || "Could not create account.");
      setStatus("idle");
      return;
    }

    const signInResponse = await signIn("phone", {
      phoneNumber: registerPhoneNumber,
      password: registerPassword,
      redirect: false,
      callbackUrl: "/dashboard",
    });

    if (signInResponse?.error) {
      setErrorMessage("Could not sign you in. Please try again.");
      setStatus("idle");
      return;
    }

    window.location.assign(signInResponse?.url || "/dashboard");
  }

  return (
    <div className="mt-8 space-y-6">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setMode("signin");
            setErrorMessage("");
          }}
          disabled={disabled}
          className={
            mode === "signin"
              ? "rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white"
              : "rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-white/30 hover:bg-white/5"
          }
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("register");
            setErrorMessage("");
          }}
          disabled={disabled}
          className={
            mode === "register"
              ? "rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white"
              : "rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-white/30 hover:bg-white/5"
          }
        >
          Create account
        </button>
      </div>

      {mode === "register" ? (
        <form className="space-y-4" onSubmit={handleRegister}>
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
          <div>
            <label
              className="block text-sm font-medium text-slate-200"
              htmlFor="registerPhoneNumber"
            >
              Phone number
            </label>
            <input
              id="registerPhoneNumber"
              name="registerPhoneNumber"
              type="tel"
              value={registerPhoneNumber}
              onChange={(e) => setRegisterPhoneNumber(e.target.value)}
              className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              placeholder="+263777123456"
              disabled={disabled}
            />
          </div>
          <div>
            <label
              className="block text-sm font-medium text-slate-200"
              htmlFor="registerPassword"
            >
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

          {errorMessage ? (
            <p className="text-sm font-medium text-rose-200">{errorMessage}</p>
          ) : null}

          <button
            type="submit"
            disabled={disabled}
            className="inline-flex w-full items-center justify-center rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Create account
          </button>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={handlePhoneSignIn}>
          <div>
            <label className="block text-sm font-medium text-slate-200" htmlFor="phoneNumber">
              Phone number
            </label>
            <input
              id="phoneNumber"
              name="phoneNumber"
              type="tel"
              autoComplete="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              placeholder="+263777123456"
              disabled={disabled}
            />
          </div>
          <div>
            <label
              className="block text-sm font-medium text-slate-200"
              htmlFor="phonePassword"
            >
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

          {errorMessage ? (
            <p className="text-sm font-medium text-rose-200">{errorMessage}</p>
          ) : null}

          <button
            type="submit"
            disabled={disabled}
            className="inline-flex w-full items-center justify-center rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Sign in
          </button>
        </form>
      )}

      <p className="text-xs text-slate-400">
        Agents and admins use the same phone sign-in. Admin pages are available based on your role.
      </p>
    </div>
  );
}
