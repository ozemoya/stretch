import { expect, it } from "vitest";
import { roadDirections } from "../lib/road-directions";
it("uses actual road maneuvers and turn coordinates", () => {
  expect(roadDirections([{ steps: [{ name: "Main St", distance: 100,
    maneuver: { type: "turn", modifier: "left", location: [-84.3, 33.7] } }] }]))
    .toEqual([{ instruction: "Turn left onto Main St", distanceMeters: 100, legIndex: 0, lat: 33.7, lon: -84.3 }]);
});
it("does not invent directions when the provider supplies no steps", () => {
  expect(roadDirections([{}])).toEqual([]);
});
