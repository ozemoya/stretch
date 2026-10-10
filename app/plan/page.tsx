import type { Metadata } from "next";
import { getCatalog } from "@/lib/catalog";
import Stretch from "@/components/Stretch";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your food list — Stretch" };

export default async function PlanPage() {
  const data = await getCatalog();
  return <Stretch {...data} mode="planner" />;
}
