"use client";
import SketchIcon from "@/components/SketchIcon";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="error">
      <SketchIcon name="map" size={88} className="sketch-state-icon" />
      <h1>A small detour.</h1>
      <p>We couldn’t load the planner. Please try again.</p>
      <button onClick={reset}>Try again</button>
    </main>
  );
}
