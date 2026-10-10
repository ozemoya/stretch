import { SEARCH_WINDOW_MS } from "./search-timing";

export type SearchFinish = "completed" | "timeout" | "error";

/** Ends the response even if a third-party adapter ignores cancellation. */
export function deadlineStream(
  requestSignal: AbortSignal,
  run: (send: (event: unknown) => void, signal: AbortSignal) => Promise<void>,
  finalEvents: (reason: SearchFinish, elapsedMs: number) => unknown[],
) {
  const encoder = new TextEncoder();
  let cancel = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const started = performance.now();
      const work = new AbortController();
      let ended = false;
      const send = (event: unknown) => {
        if (!ended) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      const finish = (reason: SearchFinish | "canceled", streamCanceled = false) => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        requestSignal.removeEventListener("abort", abort);
        work.abort(new DOMException("Search window ended", "AbortError"));
        if (reason !== "canceled") {
          for (const event of finalEvents(reason, Math.round(performance.now() - started)))
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        }
        if (!streamCanceled) controller.close();
      };
      const abort = () => finish("canceled");
      const timer = setTimeout(() => finish("timeout"), SEARCH_WINDOW_MS);
      cancel = () => finish("canceled", true);
      requestSignal.addEventListener("abort", abort, { once: true });
      if (requestSignal.aborted) return abort();
      // Install deadline and cancellation before invoking any source.
      void Promise.resolve().then(() => work.signal.aborted ? undefined : run(send, work.signal)).then(
        () => finish("completed"),
        () => finish("error"),
      );
    },
    cancel() { cancel(); },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

export function untilAborted<T>(task: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const abort = () => resolve(undefined);
    if (signal.aborted) { void task.catch(() => undefined); return abort(); }
    signal.addEventListener("abort", abort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
