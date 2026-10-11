"use client";
export type DirectionStep = { instruction: string; distanceMeters: number; legIndex: number; lat?: number; lon?: number };
export default function RouteDirections({ steps, onStep }: { steps: DirectionStep[]; onStep?: (step: DirectionStep) => void }) {
  return <details className="map-grocery-routes route-directions" open>
    <summary>Driving directions · {steps.length} steps</summary>
    {steps.length ? <ol>{steps.map((step, index) => <li key={index}>
      <button type="button" onClick={() => onStep?.(step)} aria-label={`Step ${index + 1}: ${step.instruction}`}>
        {index + 1}. {step.instruction}
      </button><small>{step.distanceMeters >= 160.9344 ? `${(step.distanceMeters / 1609.344).toFixed(1)} mi` : `${Math.round(step.distanceMeters * 3.28084)} ft`}</small>
    </li>)}</ol> : <p>Turn-by-turn instructions are unavailable from this route provider.</p>}
  </details>;
}
