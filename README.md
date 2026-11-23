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

The public homepage starts a guided CV chat on WhatsApp. A customer sends `START`, answers the prompts, reviews the information, then replies `YES` to create a US$1 order. The bot stores the draft in MongoDB and makes a PDF after payment has been manually confirmed by an administrator.

The WhatsApp webhook must point to `https://<your-domain>/api/webhooks/whatsapp` and the Meta app must be subscribed to the WhatsApp `messages` webhook field. Configure these deployment environment variables alongside the existing WhatsApp and MongoDB settings:

- `WHATSAPP_APP_SECRET`: Meta app secret used to verify signed webhook requests.
- `CV_ADMIN_PHONE`: administrator's WhatsApp number in Zimbabwe international or local format (for example, `263771234567`). This must be a separate number from the business sender.
- `CV_PAYMENT_INSTRUCTIONS`: the payment method and account details shown to CV customers.

The administrator should send `ADMIN` to the business WhatsApp number to open a chat before receiving bot notifications. After confirming payment, send `APPROVE <order-code>` to deliver the customer's PDF. `REJECT <order-code>` requests payment follow-up. Customers can send `DELETE` to remove their saved draft and orders. Drafts expire after 30 days and orders after 90 days.

The `/api/auth/whatsapp-otp` API and the legacy `send_nzvimbo_otp` webhook action remain available for the separate Nzvimbo login flow.
