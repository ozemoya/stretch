import type { Metadata } from "next";
import { getCatalog } from "@/lib/catalog";
import ListsPage from "@/components/ListsPage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your saved lists — Stretch" };

export default async function SavedListsPage() {
  const data = await getCatalog();
  return <ListsPage catalog={data.catalog} />;
}
