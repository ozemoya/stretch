import { NextRequest, NextResponse } from "next/server";
import {
  buildRouteDecisionPrompt,
  extractJsonObject,
  routeDecisionRequestSchema,
  routeDecisionResponseSchema,
} from "@/lib/route-decision";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export async function POST(request: NextRequest) {
  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: "AI route decisions are not configured. Set OPENROUTER_API_KEY on the server." },
      { status: 503 },
    );
  }

  try {
    const parsed = routeDecisionRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid route decision request" }, { status: 400 });
    }

    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost:3000",
        "X-Title": "Stretch grocery route planner",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_ROUTE_MODEL ?? "openai/gpt-4o-mini",
        temperature: 0,
        max_tokens: 180,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are a careful route planner. Output only valid JSON." },
          { role: "user", content: buildRouteDecisionPrompt(parsed.data) },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!response.ok) {
      console.warn("OpenRouter route decision failed", response.status);
      return NextResponse.json({ error: "The AI route decision service is unavailable." }, { status: 502 });
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("OpenRouter returned no message");
    const decision = routeDecisionResponseSchema.parse(extractJsonObject(content));
    if (!parsed.data.candidates.some((candidate) => candidate.id === decision.candidateId)) {
      throw new Error("OpenRouter selected an unknown route");
    }
    return NextResponse.json(decision);
  } catch (error) {
    console.warn("Could not validate AI route decision", error);
    return NextResponse.json({ error: "The AI returned an invalid route decision." }, { status: 502 });
  }
}
