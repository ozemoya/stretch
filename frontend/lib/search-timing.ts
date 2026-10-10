// Give retailer collection jobs time to return while streaming cached prices immediately.
export const SEARCH_WINDOW_MS = 30_000;
export const SEARCH_CLIENT_TIMEOUT_MS = SEARCH_WINDOW_MS + 5_000;
export const AI_PLAN_WINDOW_MS = 5_000;
