import { instacartRetailers, errorResponse } from "@/lib/live-data";
export async function GET(request: Request) {
  const zip = new URL(request.url).searchParams.get("zip") ?? "";
  if (!/^\d{5}$/.test(zip))
    return Response.json({ error: "Enter a five-digit ZIP." }, { status: 400 });
  try {
    return Response.json({ retailers: await instacartRetailers(zip) });
  } catch (e) {
    return errorResponse(e);
  }
}
