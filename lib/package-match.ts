type PackageSize = {
  kind: "volume" | "weight" | "count" | "loaf";
  amount: number;
};

function parseSize(value: string): PackageSize | null {
  const text = value.toLowerCase().replace(/\bfl\.?\s*oz\b/g, "fl oz");
  const dozen = text.match(/\b(\d+(?:\.\d+)?)\s*dozen\b/);
  if (dozen) return { kind: "count", amount: Number(dozen[1]) * 12 };
  if (/\bdozen\b/.test(text)) return { kind: "count", amount: 12 };
  const match = text.match(
    /\b(\d+(?:\.\d+)?)\s*(gallons?|gal|quarts?|qt|pints?|pt|fl oz|liters?|litres?|l|milliliters?|ml|pounds?|lbs?|ounces?|oz|kilograms?|kg|grams?|g|counts?|ct|loaves?|loaf)\b/,
  );
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  if (/^(?:gallons?|gal)$/.test(unit))
    return { kind: "volume", amount: amount * 128 };
  if (/^(?:quarts?|qt)$/.test(unit))
    return { kind: "volume", amount: amount * 32 };
  if (/^(?:pints?|pt)$/.test(unit))
    return { kind: "volume", amount: amount * 16 };
  if (unit === "fl oz") return { kind: "volume", amount };
  if (/^(?:liters?|litres?|l)$/.test(unit))
    return { kind: "volume", amount: amount * 33.814 };
  if (/^(?:milliliters?|ml)$/.test(unit))
    return { kind: "volume", amount: amount * 0.033814 };
  if (/^(?:pounds?|lbs?)$/.test(unit))
    return { kind: "weight", amount: amount * 16 };
  if (/^(?:ounces?|oz)$/.test(unit)) return { kind: "weight", amount };
  if (/^(?:kilograms?|kg)$/.test(unit))
    return { kind: "weight", amount: amount * 35.274 };
  if (/^(?:grams?|g)$/.test(unit))
    return { kind: "weight", amount: amount * 0.035274 };
  if (/^(?:counts?|ct)$/.test(unit)) return { kind: "count", amount };
  return { kind: "loaf", amount };
}

export function packageMatches(requested: string, offered: string): boolean {
  const wanted = parseSize(requested);
  const found = parseSize(offered);
  return (
    !!wanted &&
    !!found &&
    wanted.kind === found.kind &&
    Math.abs(wanted.amount - found.amount) <= wanted.amount * 0.02
  );
}

export function prioritizePackageMatches<T extends { size: string }>(
  products: T[],
  requested: string,
): T[] {
  return [...products].sort(
    (left, right) =>
      Number(packageMatches(requested, right.size)) -
      Number(packageMatches(requested, left.size)),
  );
}
