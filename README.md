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

The app looks for a published Flow named `CribMatch CV Builder` in the configured WhatsApp Business Account. If one does not exist, it creates and publishes the Flow through Meta's Graph API when a customer sends `START`. The Meta token therefore needs WhatsApp Flow management permission in addition to sending messages. Submitted test CV details are stored for up to 30 days; customers can send `DELETE` to remove them sooner.

The `/api/auth/whatsapp-otp` API and the legacy `send_nzvimbo_otp` webhook action remain available for the separate Nzvimbo login flow.
