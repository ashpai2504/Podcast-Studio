import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hunter Podcast Studio",
  description: "Turn sales reports into a two-host podcast",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
