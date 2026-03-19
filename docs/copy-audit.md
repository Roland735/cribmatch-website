# Copy Audit (Latest Pass)

## Scope
- Reviewed and revised high-impact website copy across landing, listings, informational pages, login/auth microcopy, and dashboard surfaces.
- Kept original intent while improving clarity, consistency, and engagement.

## Before / After Log

| Location | Before | After | Rationale |
|---|---|---|---|
| `src/app/page.js` (hero badge) | `A rental middleman for Zimbabwe — powered by the web + WhatsApp` | `Zimbabwe rentals, simplified on web + WhatsApp` | Shorter and cleaner value statement. |
| `src/app/page.js` (hero H1) | `Find or list rentals — fast, local, on web + WhatsApp.` | `Find your next rental with confidence.` | Stronger, user-outcome-focused headline. |
| `src/app/page.js` (hero paragraph) | Multi-line process-heavy copy | `We connect renters, landlords, and agents... with clear support.` | Improved readability and reduced cognitive load. |
| `src/app/page.js` (CTA) | `Browse sample listings` | `Browse listings` | Reduced unnecessary wording. |
| `src/app/page.js` (support line) | `Browse on the web. Chat on WhatsApp. No long forms.` | `Browse on web, finalize faster on WhatsApp.` | More direct, less repetitive. |
| `src/app/page.js` (match preview subtitle) | `What you get when you describe your needs.` | `Preview of your guided match journey.` | More professional framing. |
| `src/app/page.js` (listing label) | `2-bed garden flat in Avondale` | `2-bed garden flat · Avondale` | Cleaner visual scan pattern. |
| `src/app/page.js` (next step CTA) | `Schedule a viewing` | `Book a viewing` | Action-oriented and concise. |
| `src/app/page.js` (section heading) | `Built for Zimbabwean rentals.` | `Designed for Zimbabwe rentals.` | Smoother phrasing and consistency. |
| `src/app/page.js` (card title) | `Middleman support` | `Guided coordination` | More professional and service-specific. |
| `src/app/page.js` (landlord block title) | `Landlords & agents: list in minutes` | `Landlords and agents: list in minutes` | Consistent style and readability. |
| `src/app/page.js` (safety heading) | `Safety reminder` | `Safety notice` | Clearer compliance-oriented language. |
| `src/app/listings/page.js` (title) | `Featured rentals` | `Rentals in Zimbabwe` | Better context and SEO clarity. |
| `src/app/listings/page.js` (intro) | `Browse listings on the web...` | `Filter by location, budget, and features...` | More useful and task-specific guidance. |
| `src/app/listings/page.js` (empty state title) | `Listings` | `No listings found` | Explicit empty-state communication. |
| `src/app/listings/page.js` (empty state body) | `No matching listings...` | `Try adjusting your search...` | Actionable user guidance. |
| `src/app/how-it-works/page.js` (badge) | `Simple, human-first process` | `Simple, guided process` | Tighter and more neutral tone. |
| `src/app/how-it-works/page.js` (intro) | Longer middleman explanation | `Browse on the website, then move to WhatsApp...` | Reduced verbosity, preserved intent. |
| `src/app/how-it-works/page.js` (step copy) | `Get matches & view` body was broad | `Receive tailored matches... verification guidance.` | Better clarity and professionalism. |
| `src/app/faq/page.js` (Q&A answers) | Informal, longer answer forms | Revised concise safety/payment/coverage answers | Improved consistency, grammar, and trust tone. |
| `src/app/contact/page.js` (intro) | `Questions, partnerships, or press?` | `Questions, partnerships, or press enquiries?` | Professional wording and consistency. |
| `src/app/contact/page.js` (CTA) | `Message us on WhatsApp` | `Message on WhatsApp` | Shorter button text. |
| `src/app/pricing/page.js` (title) | `Simple, transparent pricing` | `Clear pricing` | Reduced word count while retaining meaning. |
| `src/app/pricing/page.js` (card details) | Longer explanatory bullets | Condensed bullet statements | Better scanability and consistency. |
| `src/app/renters/page.js` (title) | `Rent smarter and safer` | `Rent smarter, move with confidence` | Stronger motivational framing. |
| `src/app/renters/page.js` (tips copy) | Mixed phrasing | Standardized concise checklist language | Improved readability and consistency. |
| `src/app/landlords/page.js` (title) | `Fill vacancies faster` | `Fill vacancies faster with less back-and-forth` | Adds practical value proposition. |
| `src/app/landlords/page.js` (CTA) | `Login to list property` | `Sign in to list property` | Consistent auth terminology. |
| `src/app/user/page.js` (title) | `Welcome` | `Welcome back` | Better continuity for returning users. |
| `src/app/user/page.js` (buttons) | `Manage my listings` / `View purchases` | `Manage listings` / `View unlocked listings` | Clearer action labels with less noise. |
| `src/app/agent/page.js` (subcopy) | `Manage your listings and respond to enquiries.` | `Manage listings and respond to enquiries quickly.` | More outcome-oriented and concise. |
| `src/app/login/LoginClient.js` (error text) | `Could not send verification code.` | `Could not send the verification code.` | Improved sentence clarity and consistency. |
| `src/app/login/LoginClient.js` (auth hint) | `Use First web login.` | `choose First login.` | Matches updated control label and reduces confusion. |
| `src/app/login/LoginClient.js` (tab label) | `Reset` | `Reset password` | Specific action label; avoids ambiguity. |
| `src/app/login/LoginClient.js` (footer note) | `WhatsApp verification is web-only.` | `WhatsApp verification is for web access only.` | More explicit user guidance. |
| `src/app/user/profile/ProfileClient.js` (status and errors) | `Failed to ...` variants | `Could not ...` variants | Consistent tone across app feedback messages. |

## Accessibility / UX Notes
- Shortened button and heading labels to reduce truncation risks on smaller screens.
- Preserved semantic headings and existing focus-ring styles.
- Kept sentence structure simple for better readability and assistive parsing.

## Regression Verification
- `npm run lint` passed.
- `npm run build` passed.
- `npm run test` passed.
