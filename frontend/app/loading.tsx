import SketchIcon from "@/components/SketchIcon";

export default function Loading() {
  return (
    <main className="error">
      <SketchIcon name="cart" size={88} className="sketch-state-icon" />
      <h1>Plotting a little further…</h1>
      <p>Loading your grocery planner.</p>
    </main>
  );
}
