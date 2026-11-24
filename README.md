This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## CribMatch CV on WhatsApp

The public homepage starts a native WhatsApp Flow for CV details. A customer sends `START`, fills in and submits one in-app form, and receives a generated test PDF in WhatsApp. CV generation is free during testing; no payment or Paynow step is used.

The WhatsApp webhook must point to `https://<your-domain>/api/webhooks/whatsapp` and the Meta app must be subscribed to the WhatsApp `messages` webhook field. Keep the existing WhatsApp API token, phone number ID, webhook verify token, and MongoDB URI. Add the existing Meta app secret to the deployment environment as:

- `WHATSAPP_APP_SECRET`: the existing Meta app secret, used to verify signed webhook requests. Copy it from the Meta app settings; do not generate or rotate it.

The app looks for a published Flow named `CribMatch Full CV Builder` in the configured WhatsApp Business Account. If one does not exist, it creates and publishes the Flow through Meta's Graph API when a customer sends `START`. The Meta token therefore needs WhatsApp Flow management permission in addition to sending messages. Submitted test CV details are stored for up to 30 days; customers can send `DELETE` to remove them sooner. Published Flow assets cannot be edited in place; clone the live Flow to a new draft and validate it before changing the production flow selection. Once the replacement Flow has been cloned, validated, and published in Meta, set `WHATSAPP_CV_FLOW_ID` to its ID to route new `START` sessions to that version. Leave the variable unset to continue using the existing named Flow lookup.

### Website CV builder

The homepage offers both **Build on WhatsApp** and **Build on this website**. The website path is a six-stage guided form at `/cv/build`. It keeps work facts, education, skills, personal qualities, writing preferences, generated wording, PDF version, and generation status in separate MongoDB collections. Experience, education, and languages support additional entries. Suggested tasks and qualities start unchecked. Blank date-of-birth and identity-number fields are not requested in the default journey. A draft can be downloaded, approved, edited by revisiting the form, or tailored to another role. Website drafts and their records expire after 30 days; the PDF access link uses a random key.

Gemini wording help is optional and requires the candidate's explicit checkbox consent in the website form. Only professional wording inputs are sent to Gemini; contact information is excluded. The template writer remains available when the candidate opts out or Gemini is unavailable.

### Optional Gemini CV wording polish

The WhatsApp CV builder can use Gemini 3.1 Flash-Lite to improve the professional profile, career objective, and achievement wording before creating the PDF. If that model is unavailable, it falls back to Gemini 3.5 Flash-Lite. The API key stays on the server. To enable it, create a Gemini API key in [Google AI Studio](https://aistudio.google.com/apikey) and add these server environment variables (for local development, use `.env.local`; set them in the hosting provider for production):

- `GEMINI_API_KEY`: the key from Google AI Studio.
- `GEMINI_MODEL`: optional; defaults to `gemini-3.1-flash-lite`.
- `GEMINI_FALLBACK_MODEL`: optional; defaults to `gemini-3.5-flash-lite`.
- `GEMINI_CV_POLISH_ENABLED`: set to `false` to disable AI polishing while keeping CV PDF generation available.

Gemini is optional: without a key, or if its API is unavailable, the existing CV PDF is generated without AI. The AI request excludes name, contact details, date of birth, and ID/passport number, but it does send professional CV text to Google. Google may use free-tier prompts and responses to improve its products, so use fictional CVs for free-tier testing and do not enable this for real customer CVs until the data-use terms and user notice are appropriate.

The `/api/auth/whatsapp-otp` API and the legacy `send_nzvimbo_otp` webhook action remain available for the separate Nzvimbo login flow.
