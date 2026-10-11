import type { Metadata } from "next";
import SmartCart from "@/components/SmartCart";

export const metadata: Metadata = { title: "Trip checkout — Stretch" };
export default function CartCheckoutPage() { return <SmartCart checkout />; }
