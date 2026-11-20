import type { Metadata } from "next";
import "@/styles/material-theme.css";
import "@/styles/shell.css";
import "@/styles/conversation.css";
import "@/styles/artifacts.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ano Copilot — Research workspace",
  description: "Evidence-backed sales research and planning.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="light">
      <body>{children}</body>
    </html>
  );
}
