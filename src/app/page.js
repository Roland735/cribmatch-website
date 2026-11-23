const WHATSAPP_URL =
  "https://wa.me/263771150713?text=Hi%20CribMatch%2C%20I%27d%20like%20to%20create%20my%20CV%20for%20%241.";

const steps = [
  {
    number: "01",
    title: "Start on WhatsApp",
    description: "Tell us what kind of work you’re applying for and share your details or an old CV.",
  },
  {
    number: "02",
    title: "We shape your story",
    description: "We organise your experience, skills and education into a clean, professional CV.",
  },
  {
    number: "03",
    title: "Get your finished CV",
    description: "Review it in chat, request a correction, then receive your CV as a PDF for $1.",
  },
];

const faqs = [
  ["What do I need to get started?", "Just a WhatsApp account and the details you want on your CV. You can send a rough CV, notes, or answer a few simple questions."],
  ["How much does it cost?", "The standard CV is $1. We’ll confirm payment instructions in WhatsApp before preparing the final PDF."],
  ["Can I ask for a correction?", "Yes. Review your draft and message any corrections before you use it to apply."],
];

export default function Home() {
  return (
    <div className="overflow-hidden bg-[#07120f] text-[#f3f5ef]">
      <main>
        <section className="relative isolate mx-auto grid min-h-[680px] max-w-7xl items-center gap-14 px-6 pb-20 pt-16 lg:grid-cols-[1.05fr_.95fr] lg:px-10 lg:pb-28 lg:pt-20">
          <div className="pointer-events-none absolute -left-40 top-8 -z-10 h-96 w-96 rounded-full bg-emerald-400/10 blur-[110px]" />
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/[0.07] px-4 py-2 text-xs font-medium text-emerald-100">
              <span className="h-2 w-2 rounded-full bg-emerald-300" />
              Your CV, made on WhatsApp
            </div>
            <div className="space-y-5">
              <h1 className="max-w-[13ch] text-balance text-5xl font-semibold leading-[1.03] tracking-[-0.045em] sm:text-6xl lg:text-7xl">
                Your next opportunity starts with a <span className="text-emerald-300">better CV.</span>
              </h1>
              <p className="max-w-xl text-pretty text-base leading-8 text-[#bdc9c1] sm:text-lg">
                Turn your experience into a polished, job-ready CV through a simple WhatsApp chat. No complicated forms. No laptop needed.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-3 rounded-full bg-emerald-300 px-7 py-4 text-sm font-bold text-[#06211a] shadow-[0_12px_36px_rgba(52,211,153,.18)] transition hover:-translate-y-0.5 hover:bg-emerald-200">
                <WhatsAppIcon /> Create my CV on WhatsApp <span aria-hidden="true">↗</span>
              </a>
              <span className="px-2 text-sm text-[#a8b6ad]">One professional CV · <strong className="text-white">$1</strong></span>
            </div>
            <div className="flex flex-wrap gap-x-7 gap-y-3 border-t border-white/10 pt-6 text-xs text-[#a8b6ad]">
              <span className="inline-flex items-center gap-2"><CheckIcon /> Human-guided support</span>
              <span className="inline-flex items-center gap-2"><CheckIcon /> PDF delivered in chat</span>
              <span className="inline-flex items-center gap-2"><CheckIcon /> Made for job applications</span>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[480px] lg:ml-auto">
            <div className="absolute -inset-8 rounded-[3rem] bg-emerald-400/10 blur-3xl" />
            <div className="relative rotate-1 rounded-[2rem] border border-white/10 bg-[#0c1c17] p-4 shadow-[0_32px_100px_rgba(0,0,0,.45)] sm:p-6">
              <div className="flex items-center justify-between border-b border-white/10 px-2 pb-4">
                <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-300 text-sm font-bold text-[#09231b]">CM</div><div><p className="text-sm font-semibold">CribMatch CV</p><p className="text-xs text-[#91a39a]">online · WhatsApp</p></div></div>
                <span className="rounded-full bg-emerald-300/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[.15em] text-emerald-200">Chat preview</span>
              </div>
              <div className="space-y-3 py-5">
                <div className="ml-auto max-w-[82%] rounded-2xl rounded-tr-sm bg-[#164a39] px-4 py-3 text-sm leading-6 text-white">Hi, I need a CV for an IT support job. I have experience helping at a school.</div>
                <div className="max-w-[88%] rounded-2xl rounded-tl-sm border border-white/[0.07] bg-[#14231d] px-4 py-3 text-sm leading-6 text-[#e1e8e3]">Great. We’ll bring out your support experience, systems knowledge and the impact of your work.</div>
                <div className="ml-auto max-w-[82%] rounded-2xl rounded-tr-sm bg-[#164a39] px-4 py-3 text-sm leading-6 text-white">Can you make it look professional?</div>
                <div className="max-w-[88%] rounded-2xl rounded-tl-sm border border-white/[0.07] bg-[#14231d] px-4 py-3 text-sm leading-6 text-[#e1e8e3]">Absolutely. We’ll send a clean PDF you can share with employers. The CV is $1.</div>
              </div>
              <div className="rounded-2xl border border-emerald-200/20 bg-[#e8eee8] p-5 text-[#18372b] shadow-xl sm:p-7">
                <div className="flex items-start justify-between gap-4 border-b border-[#1a4b3820] pb-4">
                  <div><p className="text-[9px] font-bold uppercase tracking-[.24em] text-[#39815e]">Curriculum Vitae</p><p className="mt-2 text-2xl font-bold tracking-tight">Roland Mungure</p><p className="mt-1 text-xs text-[#50705e]">IT Officer · Software Developer</p></div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#c7ddce] text-sm font-bold text-[#286447]">RM</div>
                </div>
                <div className="grid grid-cols-[.8fr_1.2fr] gap-5 pt-4 text-[10px] leading-5">
                  <div className="space-y-4"><div><p className="mb-1 font-bold uppercase tracking-[.16em] text-[#39815e]">Contact</p><p>Harare, Zimbabwe</p><p>roland@email.com</p></div><div><p className="mb-1 font-bold uppercase tracking-[.16em] text-[#39815e]">Skills</p><p>Technical support<br />Web development<br />Systems administration</p></div></div>
                  <div className="space-y-4"><div><p className="mb-1 font-bold uppercase tracking-[.16em] text-[#39815e]">Profile</p><p>Practical IT professional focused on reliable support, useful systems and better digital experiences.</p></div><div><p className="mb-1 font-bold uppercase tracking-[.16em] text-[#39815e]">Experience</p><p className="font-semibold">IT Officer &amp; Software Developer</p><p>Supporting users and building tools that improve everyday work.</p></div></div>
                </div>
              </div>
            </div>
            <div className="absolute -bottom-5 -left-4 rounded-2xl border border-white/10 bg-[#10221b] px-4 py-3 shadow-xl sm:-left-9"><p className="text-[10px] uppercase tracking-[.18em] text-[#95aa9e]">Simple, fixed price</p><p className="mt-1 text-lg font-semibold">$1 <span className="text-xs font-normal text-[#a8b6ad]">per CV</span></p></div>
          </div>
        </section>

        <section id="how-it-works" className="border-y border-white/[0.08] bg-[#0b1914]">
          <div className="mx-auto max-w-7xl px-6 py-20 lg:px-10 lg:py-24">
            <div className="max-w-2xl"><p className="text-xs font-bold uppercase tracking-[.22em] text-emerald-300">How it works</p><h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">A stronger CV, in three simple steps.</h2><p className="mt-4 text-sm leading-7 text-[#aebdb4] sm:text-base">Everything happens in the chat app you already use.</p></div>
            <div className="mt-10 grid gap-4 md:grid-cols-3">{steps.map((step) => <article key={step.number} className="rounded-3xl border border-white/[0.08] bg-white/[0.025] p-6 sm:p-7"><p className="text-xs font-bold tracking-[.2em] text-emerald-300">{step.number}</p><h3 className="mt-8 text-lg font-semibold">{step.title}</h3><p className="mt-3 text-sm leading-7 text-[#aebdb4]">{step.description}</p></article>)}</div>
            <div className="mt-8 flex flex-col gap-4 rounded-3xl border border-emerald-200/15 bg-emerald-300/[0.06] p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8"><div><p className="text-lg font-semibold">Ready to get started?</p><p className="mt-1 text-sm text-[#aebdb4]">Message CribMatch and start building your CV today.</p></div><a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-emerald-300 px-6 py-3 text-sm font-bold text-[#06211a] transition hover:bg-emerald-200"><WhatsAppIcon /> Start on WhatsApp</a></div>
          </div>
        </section>

        <section id="faq" className="mx-auto max-w-4xl px-6 py-20 lg:py-24">
          <p className="text-xs font-bold uppercase tracking-[.22em] text-emerald-300">Good to know</p><h2 className="mt-4 text-3xl font-semibold tracking-tight">Questions, answered.</h2>
          <div className="mt-8 divide-y divide-white/10">{faqs.map(([question, answer]) => <details key={question} className="group py-5"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-medium marker:hidden">{question}<span className="text-xl text-emerald-300 transition group-open:rotate-45">+</span></summary><p className="max-w-3xl pt-3 text-sm leading-7 text-[#aebdb4]">{answer}</p></details>)}</div>
        </section>
      </main>
    </div>
  );
}

function WhatsAppIcon() {
  return <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true"><path d="M20 11.7a8.2 8.2 0 0 1-12.1 7.2L4 20l1.1-3.7A8.2 8.2 0 1 1 20 11.7Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M9 8.6c.2-.4.4-.4.7-.4h.4c.2 0 .3 0 .4.3l.7 1.7c.1.2 0 .4-.1.5l-.5.6c-.2.2-.2.3 0 .5.4.7 1 1.3 1.7 1.7.2.1.3.1.5-.1l.6-.7c.2-.2.3-.2.5-.1l1.6.8c.2.1.3.2.3.4v.4c0 .3-.1.5-.4.7-.5.3-1.2.5-1.8.3-1-.2-2.1-.8-3.1-1.8-1-.9-1.7-2.1-1.9-3.1-.1-.7.1-1.4.4-1.7Z" fill="currentColor"/></svg>;
}

function CheckIcon() {
  return <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 text-emerald-300" aria-hidden="true"><path d="m4 10 4 4 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
