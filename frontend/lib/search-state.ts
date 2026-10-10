import type { ScrapeReport } from "./retailer-scraper";

export type SearchStatus =
  | "idle"
  | "searching"
  | "completed"
  | "no_results"
  | "price_unavailable"
  | "integration_unavailable"
  | "timeout"
  | "error";
export const SEARCH_TIMEOUT_MS = Math.min(
  240_000,
  Math.max(5_000, Number(process.env.STRETCH_SEARCH_TIMEOUT_MS) || 90_000),
);
export function boundedJobStatus(
  status: string,
  started: number,
  now = Date.now(),
): string {
  return ["running", "starting", "pending"].includes(status) &&
    now - started >= SEARCH_TIMEOUT_MS
    ? "timeout"
    : status;
}

export function settlePendingReports(
  reports: ScrapeReport[],
  status: "timeout" | "error",
) {
  return reports.map((report) => {
    const lines = report.lines.map((line) =>
      line.searchStatus === "searching" ||
      (!line.searchStatus &&
        report.status === "pending" &&
        !line.products.length)
        ? {
            ...line,
            searchStatus: status,
            error:
              status === "timeout"
                ? "Timed out. Retry this retailer."
                : "Search failed. Retry this retailer.",
          }
        : line,
    );
    return {
      ...report,
      lines,
      status: lines.some((line) => line.products.length)
        ? ("retrieved" as const)
        : report.status === "pending"
          ? ("failed" as const)
          : report.status,
    };
  });
}

export function catalogLineStatus(
  report: ScrapeReport,
  itemId: string,
): SearchStatus {
  const line = report.lines.find((entry) => entry.item.id === itemId);
  if (line?.searchStatus) return line.searchStatus;
  if (line?.products.length) return "completed";
  if (report.status === "blocked" || report.status === "unsupported")
    return "integration_unavailable";
  if (!line) return report.status === "pending" ? "searching" : "idle";
  if (/timed?\s*out|timeout/i.test(line.error ?? "")) return "timeout";
  if (
    /waiting|running|starting|queued/i.test(line.error ?? "") &&
    report.status === "pending"
  )
    return "searching";
  if (
    /not searched|limit reached|price unknown|no price/i.test(line.error ?? "")
  )
    return "price_unavailable";
  if (
    /verified product url|source_needed|source is required/i.test(
      line.error ?? "",
    )
  )
    return "integration_unavailable";
  if (line.error) return "error";
  return "no_results";
}

export function searchStatusLabel(status: SearchStatus) {
  return (
    {
      idle: "Not searched",
      searching: "Searching website…",
      completed: "Online catalog listing found",
      no_results: "No matching result",
      price_unavailable: "Live pricing unavailable",
      integration_unavailable: "Live pricing unavailable",
      timeout: "Timed out",
      error: "Search failed",
    } satisfies Record<SearchStatus, string>
  )[status];
}

export class SearchEpoch {
  private id = 0;
  begin() {
    return ++this.id;
  }
  isCurrent(id: number) {
    return this.id === id;
  }
  cancel() {
    ++this.id;
  }
}
