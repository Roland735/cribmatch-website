"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";

const WHATSAPP_URL =
  "https://wa.me/263771150713?text=Hi%20CribMatch%2C%20I%27d%20like%20to%20create%20my%20CV%20for%20%241.";

function shouldHideChrome(pathname, session) {
  const isAdminRoute = pathname === "/admin" || pathname?.startsWith("/admin/");
  return Boolean(isAdminRoute && session?.user?.role === "admin");
}

export default function SiteChrome({ children }) {
  const pathname = usePathname();
  const { data: session } = useSession();

  if (shouldHideChrome(pathname, session)) return children;

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-white/[0.08] bg-[#07120f]/90 backdrop-blur-xl">
        <nav className="mx-auto flex h-[76px] max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
          <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="CribMatch home">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-300 text-xs font-extrabold tracking-tight text-[#06211a]">CM</span>
            <span className="text-lg font-bold tracking-tight">CribMatch</span>
          </Link>

          <div className="hidden items-center gap-8 text-sm text-[#b7c4bc] md:flex">
            <Link href="/#how-it-works" className="transition hover:text-white">How it works</Link>
            <Link href="/#faq" className="transition hover:text-white">FAQs</Link>
            {session && <Link href="/dashboard" className="transition hover:text-white">My account</Link>}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {session ? (
              <button onClick={() => signOut({ callbackUrl: "/" })} className="hidden rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-[#d8e1da] transition hover:bg-white/5 sm:inline-flex">
                Sign out
              </button>
            ) : (
              <Link href="/login" className="hidden rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-[#d8e1da] transition hover:bg-white/5 sm:inline-flex">Sign in</Link>
            )}
            <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full bg-emerald-300 px-4 py-2.5 text-xs font-bold text-[#06211a] transition hover:bg-emerald-200 sm:px-5 sm:text-sm">
              <WhatsAppIcon /> <span className="hidden sm:inline">Create my CV</span><span className="sm:hidden">Start</span>
            </a>
          </div>
        </nav>
      </header>

      {children}

      <footer className="border-t border-white/[0.08] bg-[#050d0a]">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 py-12 sm:grid-cols-[1fr_auto] sm:items-end lg:px-10">
          <div className="max-w-md">
            <Link href="/" className="inline-flex items-center gap-2 text-lg font-bold tracking-tight"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-300 text-xs font-extrabold text-[#06211a]">CM</span> CribMatch</Link>
            <p className="mt-4 text-sm leading-7 text-[#9aa99f]">A professional CV, made easier through WhatsApp. Send your experience, get a polished PDF, and take your next step.</p>
          </div>
          <div className="space-y-3 sm:text-right">
            <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-200 transition hover:text-emerald-100"><WhatsAppIcon /> +263 77 115 0713</a>
            <p className="text-xs text-[#718078]">One CV · $1 · Delivered as a PDF on WhatsApp</p>
          </div>
          <div className="flex flex-col gap-2 border-t border-white/[0.08] pt-5 text-xs text-[#718078] sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
            <p>© {new Date().getFullYear()} CribMatch. All rights reserved.</p>
            <p>WhatsApp is a registered trademark of its respective owner.</p>
          </div>
        </div>
      </footer>
    </>
  );
}

function WhatsAppIcon() {
  return <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" aria-hidden="true"><path d="M20 11.7a8.2 8.2 0 0 1-12.1 7.2L4 20l1.1-3.7A8.2 8.2 0 1 1 20 11.7Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M9 8.6c.2-.4.4-.4.7-.4h.4c.2 0 .3 0 .4.3l.7 1.7c.1.2 0 .4-.1.5l-.5.6c-.2.2-.2.3 0 .5.4.7 1 1.3 1.7 1.7.2.1.3.1.5-.1l.6-.7c.2-.2.3-.2.5-.1l1.6.8c.2.1.3.2.3.4v.4c0 .3-.1.5-.4.7-.5.3-1.2.5-1.8.3-1-.2-2.1-.8-3.1-1.8-1-.9-1.7-2.1-1.9-3.1-.1-.7.1-1.4.4-1.7Z" fill="currentColor"/></svg>;
}
