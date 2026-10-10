import { z } from "zod";
import { providerReports } from "@/lib/provider-prices";
import { normalizeCatalogReport } from "@/lib/product-ownership";
const input = z.object({
  zip: z.string().regex(/^\d{5}$/),
  start: z.boolean().default(false),
  broaden: z.boolean().default(false),
  retailers: z.array(z.string().max(80)).max(20),
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        name: z.string().min(2).max(60),
        unit: z.string().max(80),
        quantity: z.number().int().min(1).max(20),
      }),
    )
    .min(1)
    .max(30),
});
export async function POST(request: Request) {
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: "Invalid price status request." },
      { status: 400 },
    );
  const p = parsed.data;
  return Response.json(
    {
      reports: (
        await providerReports(
          p.retailers,
          p.items,
          p.zip,
          p.start,
          false,
          undefined,
          undefined,
          p.broaden,
          request.signal,
        )
      ).map((report) => normalizeCatalogReport(report, p.items)),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
