export default function FAQ() {
  const faqs = [
    {
      question: "How do payments work?",
      answer:
        "Payments are agreed directly between the tenant and the landlord/agent (e.g., cash or transfer). CribMatch helps clarify terms and reduce confusion, but we will never ask for banking PINs.",
    },
    {
      question: "Can you help verify tenants or landlords?",
      answer:
        "Yes. We can help with basic verification steps and guidance where possible. Always do in-person viewings and confirm identity/ownership before paying deposits.",
    },
    {
      question: "What areas do you cover?",
      answer:
        "We currently focus on Harare and surrounding suburbs and are expanding to more cities. Message us your suburb/city and we’ll confirm coverage.",
    },
    {
      question: "How long until my listing appears?",
      answer:
        "Once you send details on WhatsApp, we review and publish quickly (often same-day). We’ll confirm timelines in chat.",
    },
    {
      question: "Is it safe?",
      answer:
        "Safety is a priority. We verify contact details where possible and share scam-avoidance guidance. Never share banking PINs and never pay deposits before viewing in person.",
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
            Common questions about renting and listing with CribMatch.
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
              Still have questions?
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Message us on WhatsApp and we’ll help you quickly.
            </p>
          </div>
          <a
            href="https://wa.me/263777215826"
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
