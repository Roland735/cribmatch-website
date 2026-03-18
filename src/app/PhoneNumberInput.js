"use client";

import { useMemo } from "react";

const COUNTRY_OPTIONS = [
  { code: "ZW", label: "Zimbabwe", dialCode: "+263" },
  { code: "ZA", label: "South Africa", dialCode: "+27" },
  { code: "BW", label: "Botswana", dialCode: "+267" },
  { code: "ZM", label: "Zambia", dialCode: "+260" },
  { code: "MZ", label: "Mozambique", dialCode: "+258" },
  { code: "KE", label: "Kenya", dialCode: "+254" },
];

const DEFAULT_DIAL_CODE = "+263";

function digitsOnly(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

function detectCountryAndLocal(value) {
  const raw = String(value || "").trim();
  const digits = digitsOnly(raw);
  if (!digits) {
    return { dialCode: DEFAULT_DIAL_CODE, local: "" };
  }

  const sorted = COUNTRY_OPTIONS
    .slice()
    .sort((a, b) => b.dialCode.length - a.dialCode.length);

  for (const option of sorted) {
    const dialDigits = digitsOnly(option.dialCode);
    if (digits.startsWith(dialDigits)) {
      return { dialCode: option.dialCode, local: digits.slice(dialDigits.length) };
    }
  }

  if (raw.startsWith("0") && digits.length > 1) {
    return { dialCode: DEFAULT_DIAL_CODE, local: digits.slice(1) };
  }

  return { dialCode: DEFAULT_DIAL_CODE, local: digits };
}

function composeNumber(dialCode, local) {
  const dialDigits = digitsOnly(dialCode);
  const localDigits = digitsOnly(local).replace(/^0+/, "");
  return `+${dialDigits}${localDigits}`;
}

export default function PhoneNumberInput({
  id,
  name,
  value,
  onChange,
  disabled = false,
  placeholder = "771234567",
  label,
}) {
  const parsed = useMemo(() => detectCountryAndLocal(value), [value]);

  return (
    <div>
      {label ? (
        <label className="block text-sm font-medium text-slate-200" htmlFor={id}>
          {label}
        </label>
      ) : null}
      <div className="mt-2 grid grid-cols-[170px_1fr] gap-2">
        <select
          id={`${id || name}-country`}
          value={parsed.dialCode}
          onChange={(event) => {
            const next = composeNumber(event.target.value, parsed.local);
            onChange?.(next);
          }}
          disabled={disabled}
          className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
        >
          {COUNTRY_OPTIONS.map((option) => (
            <option key={option.code} value={option.dialCode}>
              {option.label} ({option.dialCode})
            </option>
          ))}
        </select>
        <input
          id={id}
          name={name}
          type="tel"
          autoComplete="tel"
          inputMode="numeric"
          value={parsed.local}
          onChange={(event) => {
            const next = composeNumber(parsed.dialCode, event.target.value);
            onChange?.(next);
          }}
          className="block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
          placeholder={placeholder}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
