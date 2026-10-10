import { fuelQuote, errorResponse } from "@/lib/live-data";
export async function GET() {
  try {
    return Response.json(await fuelQuote());
  } catch (e) {
    return errorResponse(e);
  }
}
