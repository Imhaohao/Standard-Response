import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Fira_Sans, League_Spartan, Public_Sans, Sofia_Sans_Condensed } from "next/font/google";
import { ConvexClientProvider } from "@/components/convex-client-provider";
import { PRODUCT_NAME } from "@/lib/brand";
import "./globals.css";

// Fira Sans sets the interface: open, sturdy shapes that stay legible small and under stress.
// Public Sans is the fallback behind the deck and the big figures.
// Sofia Sans Condensed carries the big figures, the way emergency signage does.
const publicSans = Public_Sans({ variable: "--font-public-sans", subsets: ["latin"] });
const firaSans = Fira_Sans({ variable: "--font-fira-sans", subsets: ["latin"], weight: ["400", "600", "700", "800"], style: ["normal", "italic"] });
const sofiaCondensed = Sofia_Sans_Condensed({ variable: "--font-sofia-condensed", subsets: ["latin"] });
// Stands in for Verlag, the name's face, wherever the unlicensed Verlag file isn't installed.
const leagueSpartan = League_Spartan({ variable: "--font-league-spartan", subsets: ["latin"] });

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} call floor`,
  description: "Watch and steer the evacuation calling agents.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${publicSans.variable} ${firaSans.variable} ${sofiaCondensed.variable} ${leagueSpartan.variable} h-full antialiased`}>
      <body className="min-h-full">
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
