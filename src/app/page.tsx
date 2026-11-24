import type { Metadata } from "next";

import { LandingHome } from "@/components/home/landing-home";

export const metadata: Metadata = {
  title: "Ano — Sales research workspace",
  description:
    "Turn a product brief into researched accounts, verified work emails, and plain-spoken outreach drafts.",
};

export default function HomePage() {
  return <LandingHome />;
}
