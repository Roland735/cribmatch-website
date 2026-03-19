export default function FAQ() {
  const faqs = [
    {
      question: "How do payments work?",
      answer:
        "Payment terms are agreed directly between renter and landlord or agent (for example, cash or transfer). CribMatch helps clarify terms and will never ask for banking PINs.",
    },
    {
      question: "Can you help verify tenants or landlords?",
      answer:
        "Yes. We provide practical verification guidance where possible. Always do in-person viewings and confirm identity or ownership before paying a deposit.",
    },
    {
      question: "What areas do you cover?",
      answer:
        "We currently focus on Harare and nearby suburbs, with expansion to more cities in progress. Message your suburb or city and we will confirm coverage.",
    },
    {
      question: "How long until my listing appears?",
      answer:
        "After you send details on WhatsApp, we review and publish quickly, often the same day. We confirm timelines in chat.",
    },
    {
      question: "Is it safe?",
      answer:
        "Safety is a priority. We verify contact details where possible and share scam-prevention guidance. Never share banking PINs or pay a deposit before viewing in person.",
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-16 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
            FAQ
          </div>
          <h1 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Frequently asked questions
          </h1>
          <p className="mt-4 text-pretty text-base leading-relaxed text-slate-300 sm:text-lg">
            Answers to common questions about renting and listing with CribMatch.
          </p>
        </div>

        <div className="mx-auto mt-12 max-w-3xl">
          <dl className="divide-y divide-white/10 rounded-3xl border border-white/10 bg-slate-900/40">
            {faqs.map((faq) => (
              <div key={faq.question} className="grid gap-2 p-6 sm:grid-cols-12 sm:gap-8">
                <dt className="text-sm font-semibold text-white sm:col-span-5">
                  {faq.question}
                </dt>
                <dd className="text-sm leading-6 text-slate-300 sm:col-span-7">
                  {faq.answer}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="mx-auto mt-12 flex max-w-3xl flex-col items-center justify-between gap-4 rounded-3xl border border-white/10 bg-slate-900/40 p-6 text-center sm:flex-row sm:text-left">
          <div>
            <p className="text-sm font-semibold text-white">
              Need more help?
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Message us on WhatsApp for fast support.
            </p>
          </div>
          <a
            href="https://wa.me/263771150713"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300"
          >
            Chat on WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}
