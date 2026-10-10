"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="error">
      <h1>A small detour.</h1>
      <p>We couldn’t load the planner. Please try again.</p>
      <button onClick={reset}>Try again</button>
    </main>
  );
}
