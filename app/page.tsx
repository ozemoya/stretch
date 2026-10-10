import { getCatalog } from "@/lib/catalog";
import Stretch from "@/components/Stretch";
export const dynamic = "force-dynamic";
export default async function Page() {
  const data = await getCatalog();
  return <Stretch {...data} />;
}
