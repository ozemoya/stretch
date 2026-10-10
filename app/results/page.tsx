import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Find your next best stop — Stretch",
  description: "Compare the live grocery prices and nearby gas stops for your list.",
};

export default function ResultsPage() {
  redirect("/plan/results");
}
