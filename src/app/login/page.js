import LoginClient from "./LoginClient";

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50">
      <div className="mx-auto max-w-lg px-6 py-16 lg:px-8">
        <div className="rounded-3xl border border-white/10 bg-slate-900/50 p-8">
          <h1 className="text-balance text-2xl font-semibold tracking-tight text-white">
            Sign in
          </h1>
          <p className="mt-2 text-sm text-slate-300">
            Everyone signs in here using their phone number.
          </p>
          <LoginClient />
        </div>
      </div>
    </div>
  );
}
