import type { Metadata } from "next";
import { Fira_Code, Fira_Sans } from "next/font/google";
import "leaflet/dist/leaflet.css";
import "./globals.css";

// Dashboard pairing: Fira Sans for labels and prose, Fira Code for figures.
const firaSans = Fira_Sans({
  variable: "--font-fira-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const firaCode = Fira_Code({
  variable: "--font-fira-code",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "AEGIS — Evacuation Simulation",
  description:
    "Agent-based evacuation simulator: stress-test evacuation plans against congestion and shelter capacity before an emergency. Synthetic-data prototype.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${firaSans.variable} ${firaCode.variable} h-full antialiased`}
    >
      <body className="h-full bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
