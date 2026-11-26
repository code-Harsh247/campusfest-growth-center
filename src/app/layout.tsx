import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Growth Center",
  description: "Command center for the CampusFest attendee-growth campaign",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
