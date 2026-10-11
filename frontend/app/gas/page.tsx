import type { Metadata } from "next";
import { Suspense } from "react";
import GasPricePicker from "@/components/GasPricePicker";

export const metadata: Metadata = { title: "Gas stops — Stretch" };
export default function GasPage() { return <Suspense fallback={<p role="status">Opening gas stops…</p>}><GasPricePicker /></Suspense>; }
