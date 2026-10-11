import { afterEach, describe, expect, it, vi } from "vitest";
import { checkedFetch } from "../lib/live-data";

afterEach(() => vi.unstubAllGlobals());

describe("provider errors", () => {
  it("explains Places website restrictions without exposing Google's response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: {
              message: "Sensitive provider data: secret-key",
              details: [
                { reason: "API_KEY_HTTP_REFERRER_BLOCKED" },
                { metadata: { consumer: "private-project" } },
              ],
            },
          },
          { status: 403 },
        ),
      ),
    );

    const error = await checkedFetch(
      "https://places.googleapis.com/v1/places:searchNearby",
    ).catch((error: unknown) => error);
    expect(error).toMatchObject({
      status: 503,
      message:
        "Google Places rejected the server key's website restrictions. Configure a separate server key for Places API (New).",
    });
    expect(String(error)).not.toMatch(/secret-key|private-project/);
  });

  it.each([
    [
      "https://places.googleapis.com/v1/places:searchNearby",
      '{"error":{"message":"secret-key"}}',
      403,
      502,
    ],
    [
      "https://places.googleapis.com/v1/places:searchNearby",
      "not JSON: secret-key",
      403,
      502,
    ],
    [
      "https://example.com/data",
      '{"error":{"details":[{"reason":"API_KEY_HTTP_REFERRER_BLOCKED"}]}}',
      403,
      502,
    ],
    [
      "https://places.googleapis.com/v1/places:searchNearby",
      "secret-key",
      429,
      429,
    ],
  ])(
    "keeps unrelated and malformed responses private (%s, %s, %s)",
    async (url, body, status, expectedStatus) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(body, { status })),
      );
      await expect(checkedFetch(url)).rejects.toMatchObject({
        status: expectedStatus,
        message:
          status === 429
            ? "The provider is busy. Please try again later."
            : "The provider could not return data. Please try again later.",
      });
    },
  );
});
