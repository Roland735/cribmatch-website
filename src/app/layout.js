import "./globals.css";
import SiteChrome from "./SiteChrome";

export const metadata = {
  title: "CribMatch Zimbabwe — Web + WhatsApp Rental Assistant | Find Rentals & List Properties",
  description:
    "CribMatch connects renters, landlords and agents across Zimbabwe using the web and WhatsApp. Browse rentals online, then chat to get matched, confirm availability, and schedule viewings.",
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
