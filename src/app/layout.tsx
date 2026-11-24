import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import "@material/web/typography/md-typescale-styles.css";
import "@/styles/material-theme.css";
import "@/styles/shell.css";
import "@/styles/conversation.css";
import "@/styles/artifacts.css";
import "./globals.css";

const roboto = Roboto({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  variable: "--font-roboto",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ano Copilot — Research workspace",
  description: "Evidence-backed sales research and planning.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="light" className={`${roboto.variable} ${roboto.className}`}>
      <body>{children}</body>
    </html>
  );
}
