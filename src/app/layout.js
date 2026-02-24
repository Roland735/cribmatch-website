import "./globals.css";
import SiteChrome from "./SiteChrome";

export const metadata = {
  title: {
    default: "CribMatch Zimbabwe — Web + WhatsApp Rental Assistant",
    template: "%s | CribMatch Zimbabwe",
  },
  description:
    "CribMatch connects renters, landlords and agents across Zimbabwe using the web and WhatsApp. Browse rentals online, then chat to get matched, confirm availability, and schedule viewings.",
  keywords: ["rentals", "Zimbabwe", "Harare", "apartments", "houses for rent", "WhatsApp rental assistant", "CribMatch"],
  authors: [{ name: "CribMatch" }],
  creator: "CribMatch",
  openGraph: {
    type: "website",
    locale: "en_ZW",
    url: "https://cribmatch.co.zw",
    siteName: "CribMatch Zimbabwe",
    title: "CribMatch Zimbabwe — Web + WhatsApp Rental Assistant",
    description: "Find your next home in Zimbabwe via web or WhatsApp.",
    images: [
      {
        url: "/logo.png",
        width: 8000,
        height: 6000,
        alt: "CribMatch Zimbabwe",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CribMatch Zimbabwe — Web + WhatsApp Rental Assistant",
    description: "Find your next home in Zimbabwe via web or WhatsApp.",
    images: ["/logo.png"],
  },
  icons: {
    icon: "/logo.png",
    shortcut: "/logo.png",
    apple: "/logo.png",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="antialiased bg-slate-950 text-slate-50">
        <SiteChrome>{children}</SiteChrome>
      </body>
    </html>
  );
}
