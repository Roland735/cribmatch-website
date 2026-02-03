export default function Contact() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-16 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
            Contact
          </div>
          <h1 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Get in touch
          </h1>
          <p className="mt-4 text-pretty text-base leading-relaxed text-slate-300 sm:text-lg">
            Questions, partnerships, or press? Reach out and we’ll respond as
            soon as possible.
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-4xl gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
            <h2 className="text-base font-semibold text-white">Chat with us</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              The fastest way to get help or find a rental.
            </p>
            <a
              href="https://wa.me/263777215826"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300"
            >
              WhatsApp: +263 777 215 826
            </a>
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
            <h2 className="text-base font-semibold text-white">Email us</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              For partnerships, press, or formal enquiries.
            </p>
            <a
              href="mailto:rolandmungure@cribmatch.org"
              className="mt-5 inline-flex text-sm font-semibold text-emerald-200 transition hover:text-emerald-100"
            >
              rolandmungure@cribmatch.org
            </a>
          </div>
        </div>

        <div className="mx-auto mt-6 max-w-4xl rounded-3xl border border-white/10 bg-slate-900/40 p-6">
          <h2 className="text-base font-semibold text-white">Send a message</h2>
          <form className="mt-6 grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-1">
              <label htmlFor="name" className="block text-sm font-medium text-slate-200">
                Name
              </label>
              <input
                type="text"
                name="name"
                id="name"
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>
            <div className="sm:col-span-1">
              <label htmlFor="email" className="block text-sm font-medium text-slate-200">
                Email
              </label>
              <input
                type="email"
                name="email"
                id="email"
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="message" className="block text-sm font-medium text-slate-200">
                Message
              </label>
              <textarea
                name="message"
                id="message"
                rows={4}
                className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <button
                type="submit"
                className="rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300"
              >
                Send message
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
