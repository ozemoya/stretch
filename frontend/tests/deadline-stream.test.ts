import { afterEach, expect, it, vi } from "vitest";
import { deadlineStream } from "../lib/deadline-stream";
import { SEARCH_WINDOW_MS } from "../lib/search-timing";
afterEach(() => vi.useRealTimers());

it("closes a stuck stream by deadline and ignores late provider callbacks", async () => {
  vi.useFakeTimers();
  let late: ((value: unknown) => void) | undefined;
  let signal: AbortSignal | undefined;
  const response = deadlineStream(new AbortController().signal, async (send, workSignal) => {
    late = send; signal = workSignal;
    send({ type: "report", price: 329 });
    await new Promise(() => {});
  }, (reason, elapsedMs) => [{ type: "complete", reason, elapsedMs }]);
  const text = response.text();
  await vi.advanceTimersByTimeAsync(SEARCH_WINDOW_MS);
  const events = (await text).trim().split("\n").map(line => JSON.parse(line));
  expect(events).toEqual([{ type: "report", price: 329 }, { type: "complete", reason: "timeout", elapsedMs: SEARCH_WINDOW_MS }]);
  expect(signal?.aborted).toBe(true);
  expect(() => late?.({ price: 999 })).not.toThrow();
});

it("aborts source work when the reader cancels and emits no completion for obsolete queries", async () => {
  let signal: AbortSignal | undefined;
  const final = vi.fn(() => [{ type: "complete" }]);
  const response = deadlineStream(new AbortController().signal, async (_send, workSignal) => {
    signal = workSignal;
    await new Promise(() => {});
  }, final);
  await Promise.resolve();
  await response.body!.cancel();
  expect(signal?.aborted).toBe(true);
  expect(final).not.toHaveBeenCalled();
});
