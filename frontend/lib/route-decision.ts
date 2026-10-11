import { z } from "zod";

export const routeDecisionRequestSchema = z.object({
  preferences: z.object({
    priority: z.enum(["balanced", "lowest_cost", "fewest_stops"]),
    maxStops: z.number().int().min(1).max(3),
    minExtraStopSavingsCents: z.number().int().nonnegative(),
    budgetCents: z.number().int().nonnegative(),
  }),
  items: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    quantity: z.number().int().positive(),
  })).min(1).max(30),
  gas: z.object({
    selected: z.boolean(),
    reportedPrice: z.number().finite().nonnegative().nullable(),
    gallonsNeeded: z.number().finite().positive().nullable(),
    stationName: z.string().nullable(),
  }),
  candidates: z.array(z.object({
    id: z.string().min(1),
    storeNames: z.array(z.string().min(1)).min(1).max(3),
    routeOrder: z.array(z.string().min(1)).min(1).max(3),
    groceryCents: z.number().int().nonnegative(),
    drivingFuelCents: z.number().int().nonnegative(),
    gasPurchaseCents: z.number().int().nonnegative(),
    totalCents: z.number().int().nonnegative(),
    miles: z.number().finite().nonnegative(),
    minutes: z.number().finite().nonnegative(),
    gasStopIncluded: z.boolean(),
  })).min(1).max(100),
});

export type RouteDecisionRequest = z.infer<typeof routeDecisionRequestSchema>;

export const routeDecisionResponseSchema = z.object({
  candidateId: z.string().min(1),
  rationale: z.string().min(1).max(600),
});

export type RouteDecisionResponse = z.infer<typeof routeDecisionResponseSchema>;

export function buildRouteDecisionPrompt(input: RouteDecisionRequest) {
  return `You are the final route decision assistant for a grocery trip.

Choose exactly one candidate route from the supplied candidates. The user asked
for the most economical complete route, so minimize the supplied totalCents
first, while respecting the maximum stops, savings threshold, budget, and gas
logic. The candidates
were calculated from verified product prices and a road routing matrix. Never
invent stores, prices, distances, or route IDs. Do not recalculate totals.

Decision rules, in order:
1. Never choose a candidate over the user's budget when any candidate is within budget.
2. Respect the user's priority: lowest_cost favors totalCents; fewest_stops favors
   fewer stores; balanced weighs total cost, stops, and drive time.
3. A gas stop is optional. Include it only when gasStopIncluded is true and its
   overall candidate total is justified by the supplied totals.
4. Prefer a complete candidate with fewer stores when the cost difference is small.
5. If candidates are otherwise comparable, prefer fewer miles and minutes.

Return JSON only in this exact shape:
{"candidateId":"<one supplied candidate id>","rationale":"<brief explanation grounded in the supplied facts>"}

Trip preferences:
${JSON.stringify(input.preferences)}

Items:
${JSON.stringify(input.items)}

Gas context:
${JSON.stringify(input.gas)}

Candidates:
${JSON.stringify(input.candidates)}`;
}

export function extractJsonObject(value: string): unknown {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1] ?? value;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("OpenRouter returned no JSON object");
  return JSON.parse(candidate.slice(start, end + 1));
}
