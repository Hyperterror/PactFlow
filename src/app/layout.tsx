import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "PactFlow — agreements, delivery, payments",
    template: "%s · PactFlow",
  },
  description:
    "PactFlow turns a freelance brief into a negotiated, versioned agreement, a controlled delivery trail, and a payment that only releases once the work is accepted.",
};

/**
 * `themeColor` belongs to the viewport export in Next 14+, not to metadata —
 * declaring it in metadata silently drops the tag. Light is the default, so the
 * static value matches the ivory canvas; the client updates it on theme toggle.
 */
export const viewport: Viewport = {
  themeColor: "#f5f3ed",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
         * Applies a previously chosen dark theme before first paint. Light is
         * the default, so an absent key leaves the document as-is.
         */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("pactflow-theme")==="dark"){document.documentElement.dataset.theme="dark";requestAnimationFrame(function(){var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","#1c2321")})}}catch(e){}`,
          }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
