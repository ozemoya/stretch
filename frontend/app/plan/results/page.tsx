import type { Metadata } from "next";
import CheckoutResults from "@/components/CheckoutResults";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Stores & gas — Stretch" };

export default function ResultsPage() {
  return <Suspense fallback={<p role="status">Opening your comparison…</p>}><CheckoutResults /></Suspense>;
}
