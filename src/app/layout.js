import "./globals.css";
import SiteChrome from "./SiteChrome";
import Providers from "./Providers";

export const metadata = {
  metadataBase: new URL("https://cribmatch.co.zw"),
  title: {
    default: "CribMatch — CV Builder on WhatsApp",
    template: "%s | CribMatch CV",
  },
  description:
    "Create a professional CV through WhatsApp with CribMatch. Get guided help turning your experience into a clean, job-ready PDF for $1.",
  keywords: ["CV builder", "resume builder", "Zimbabwe", "Harare", "WhatsApp CV", "professional CV", "CribMatch"],
  authors: [{ name: "CribMatch" }],
  creator: "CribMatch",
  openGraph: {
    type: "website",
    locale: "en_ZW",
    url: "https://cribmatch.co.zw",
    siteName: "CribMatch Zimbabwe",
    title: "CribMatch — CV Builder on WhatsApp",
    description: "Build a professional CV in a simple WhatsApp chat. Get a polished PDF for $1.",
    images: [{ url: "/cribmatch-social.svg", width: 1200, height: 630, alt: "CribMatch CV Builder on WhatsApp" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "CribMatch — CV Builder on WhatsApp",
    description: "Build a professional CV in a simple WhatsApp chat. Get a polished PDF for $1.",
    images: ["/cribmatch-social.svg"],
  },
  icons: {
    icon: "/cribmatch-icon.svg",
    shortcut: "/cribmatch-icon.svg",
    apple: "/cribmatch-icon.svg",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="antialiased bg-slate-950 text-slate-50">
        <Providers>
          <SiteChrome>{children}</SiteChrome>
        </Providers>
      </body>
    </html>
  );
}
