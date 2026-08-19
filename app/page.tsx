import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Home | AI Team Chat",
  description: "Redirecting to your AI team workspace...",
};

export default function Home() {
  redirect("/chat/all-team");
}
