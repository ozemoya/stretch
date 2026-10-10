import type { Metadata } from "next";
import TripCheckout from "@/components/TripCheckout";

export const metadata: Metadata = { title: "Trip review — Stretch" };

export default function ReviewPage() {
  return <TripCheckout />;
}
