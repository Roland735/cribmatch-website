import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import SignOutButton from "../SignOutButton";

export default async function UserLayout({ children }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  const role = session?.user?.role;
  if (role !== "user" && role !== "agent" && role !== "admin") {
    redirect("/login");
  }

  const phoneNumber =
    typeof session?.user?.phoneNumber === "string" ? session.user.phoneNumber : "";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[18rem_1fr]">
        <aside className="hidden border-r border-white/10 bg-slate-950/60 lg:block">
          <div className="flex h-16 items-center justify-between border-b border-white/10 px-5">
            <Link href="/user" className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-400/10 ring-1 ring-slate-300/20">
                <span className="text-sm font-semibold text-slate-100">CM</span>
              </div>
              <div className="leading-tight">
                <p className="text-sm font-semibold text-white">Home</p>
                <p className="text-xs text-slate-400">Account</p>
              </div>
            </Link>
          </div>

          <nav className="p-4 text-sm">
            <div className="grid gap-1 text-slate-200">
              <Link
                href="/user"
                className="rounded-xl px-3 py-2 font-semibold transition hover:bg-white/5 hover:text-white"
              >
                Home
              </Link>
              <Link
                href="/listings"
                className="rounded-xl px-3 py-2 transition hover:bg-white/5 hover:text-white"
              >
                Browse listings
              </Link>
              <Link
                href="/contact"
                className="rounded-xl px-3 py-2 transition hover:bg-white/5 hover:text-white"
              >
                Contact
              </Link>
              {role === "agent" || role === "admin" ? (
                <Link
                  href={role === "admin" ? "/admin" : "/agent"}
                  className="rounded-xl px-3 py-2 transition hover:bg-white/5 hover:text-white"
                >
                  Open console
                </Link>
              ) : null}
            </div>

            <div className="mt-6 border-t border-white/10 pt-4">
              <SignOutButton
                className="block rounded-xl px-3 py-2 text-slate-200 transition hover:bg-white/5 hover:text-white"
              />
            </div>
          </nav>
        </aside>

        <div className="flex min-w-0 flex-col">
          <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/70 backdrop-blur">
            <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 lg:max-w-7xl lg:px-8">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Account
                </p>
                <p className="text-sm font-semibold text-white">
                  Search & shortlist rentals
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="hidden text-right sm:block">
                  <p className="text-xs text-slate-400">Signed in as</p>
                  <p className="text-sm font-semibold text-white">
                    {session.user.name || phoneNumber || "User"}
                  </p>
                </div>
                <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-100 ring-1 ring-inset ring-white/10">
                  {role === "admin" ? "Admin" : role === "agent" ? "Agent" : "User"}
                </span>
              </div>
            </div>
          </header>

          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:max-w-7xl lg:px-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
