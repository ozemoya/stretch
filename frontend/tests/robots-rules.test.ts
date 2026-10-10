import { expect, it } from "vitest";
import { robotsAllows } from "../lib/robots-rules";

it("matches the actual catalog path instead of blocking every disallow rule", () => {
  const rules = `User-agent: *\nDisallow: /q/search?id=*\nDisallow: /private\nAllow: /private/preview`;
  expect(robotsAllows(rules, "https://www.lidl.com/q/search?q=milk")).toBe(
    true,
  );
  expect(robotsAllows(rules, "https://www.lidl.com/q/search?id=123")).toBe(
    false,
  );
  expect(robotsAllows(rules, "https://www.lidl.com/private/cart")).toBe(false);
  expect(robotsAllows(rules, "https://www.lidl.com/private/preview")).toBe(
    true,
  );
  expect(robotsAllows("", "https://www.lidl.com/q/search?q=milk")).toBe(false);
});
