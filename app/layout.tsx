import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Archivo } from "next/font/google";
import { ConvexClientProvider } from "@/components/convex-client-provider";
import { PRODUCT_NAME } from "@/lib/brand";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} call floor`,
  description: "Watch and steer the evacuation calling agents.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} h-full antialiased`}>
      <body className="min-h-full">
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
