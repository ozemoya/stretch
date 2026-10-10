import { krogerConfigured, localFuelConfigured } from "@/lib/live-data";
export async function GET() {
  return Response.json({
    localFuel: localFuelConfigured(),
    kroger: krogerConfigured(),
    instacart: !!process.env.INSTACART_API_KEY,
  });
}
