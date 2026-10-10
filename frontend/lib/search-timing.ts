// Keep streaming early results while slower retailer jobs finish. A deadline is
// still required so a provider that never responds cannot leave the UI loading.
export const SEARCH_WINDOW_MS = Math.min(
  300_000,
  Math.max(
    30_000,
    Number(process.env.NEXT_PUBLIC_STRETCH_SEARCH_TIMEOUT_MS) || 120_000,
  ),
);
// Leave enough time for the server to send its final streamed result.
export const SEARCH_CLIENT_TIMEOUT_MS = SEARCH_WINDOW_MS + 20_000;
export const AI_PLAN_WINDOW_MS = 5_000;
