import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Public_Sans, Sofia_Sans_Condensed } from "next/font/google";
import { ConvexClientProvider } from "@/components/convex-client-provider";
import { PRODUCT_NAME } from "@/lib/brand";
import "./globals.css";

// Public Sans is the US Web Design System face: plain, trusted, legible under stress.
// Sofia Sans Condensed carries the big figures, the way emergency signage does.
const publicSans = Public_Sans({ variable: "--font-public-sans", subsets: ["latin"] });
const sofiaCondensed = Sofia_Sans_Condensed({ variable: "--font-sofia-condensed", subsets: ["latin"] });

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} call floor`,
  description: "Watch and steer the evacuation calling agents.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${publicSans.variable} ${sofiaCondensed.variable} h-full antialiased`}>
      <body className="min-h-full">
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
