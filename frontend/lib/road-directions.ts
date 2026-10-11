type RoadStep = { distance?: number; name?: string; destinations?: string;
  maneuver?: { type?: string; modifier?: string; exit?: number; location?: number[] } };
/** Format the road router's actual maneuvers, without inferring missing turns. */
export function roadDirections(legs: { steps?: RoadStep[] }[]) {
  return legs.flatMap((leg, legIndex) => (leg.steps ?? []).flatMap((step) => {
    const maneuver = step.maneuver;
    if (!maneuver?.type) return [];
    const modifier = maneuver.modifier?.replace(/_/g, " ") ?? "";
    const road = step.name ? ` onto ${step.name}` : "";
    let instruction: string;
    switch (maneuver.type) {
      case "depart": instruction = `Start${step.name ? ` on ${step.name}` : " driving"}`; break;
      case "arrive": instruction = `Arrive at your stop${modifier ? ` on the ${modifier}` : ""}`; break;
      case "roundabout": case "rotary": instruction = `Enter the roundabout${maneuver.exit ? ` and take exit ${maneuver.exit}` : ""}${road}`; break;
      case "turn": instruction = `Turn ${modifier || "as indicated"}${road}`; break;
      case "fork": instruction = `Keep ${modifier || "on the route"}${road}`; break;
      case "merge": instruction = `Merge${modifier ? ` ${modifier}` : ""}${road}`; break;
      case "off ramp": instruction = `Take the exit${modifier ? ` ${modifier}` : ""}${road}`; break;
      case "on ramp": instruction = `Take the ramp${modifier ? ` ${modifier}` : ""}${road}`; break;
      default: instruction = `Continue${modifier ? ` ${modifier}` : ""}${road}`;
    }
    return [{ instruction, distanceMeters: step.distance ?? 0, legIndex,
      lon: maneuver.location?.[0], lat: maneuver.location?.[1] }];
  }));
}
