type PackageSize = {
  kind: "volume" | "weight" | "count" | "loaf";
  amount: number;
};

export function parseSize(value: string): PackageSize | null {
  const text = value.toLowerCase().replace(/\bfl\.?\s*oz\b/g, "fl oz");
  const multipack = text.match(
    /\b(\d+)\s*(?:x|×)\s*(\d+(?:\.\d+)?)\s*(fl oz|oz|lbs?|ct|counts?)\b/,
  );
  if (multipack) {
    const each = parseSize(`${multipack[2]} ${multipack[3]}`);
    return each
      ? { ...each, amount: each.amount * Number(multipack[1]) }
      : null;
  }
  const dozen = text.match(/\b(\d+(?:\.\d+)?)\s*doz(?:en)?\b/);
  if (dozen) return { kind: "count", amount: Number(dozen[1]) * 12 };
  if (/\bdoz(?:en)?\b/.test(text)) return { kind: "count", amount: 12 };
  const match = text.match(
    /\b(\d+(?:\.\d+)?)\s*(gallons?|gal|quarts?|qt|pints?|pt|fl oz|liters?|litres?|l|milliliters?|ml|pounds?|lbs?|ounces?|oz|kilograms?|kg|grams?|g|counts?|ct|each|packs?|pk|loaves?|loaf)\b/,
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
  if (/^(?:counts?|ct|each|packs?|pk)$/.test(unit))
    return { kind: "count", amount };
  return { kind: "loaf", amount };
}

export function normalizedUnitPrice(priceCents: number, size: string) {
  if (!Number.isFinite(priceCents) || priceCents <= 0) return null;
  const parsed = parseSize(size);
  if (!parsed || parsed.amount <= 0) return null;
  const baseCents = priceCents / parsed.amount;
  if (parsed.kind === "volume") {
    return {
      baseCents,
      baseUnit: "fl oz" as const,
      displayCents: parsed.amount >= 128 ? baseCents * 128 : baseCents,
      displayUnit: parsed.amount >= 128 ? "gal" : "fl oz",
    };
  }
  if (parsed.kind === "weight") {
    return {
      baseCents,
      baseUnit: "oz" as const,
      displayCents: parsed.amount >= 16 ? baseCents * 16 : baseCents,
      displayUnit: parsed.amount >= 16 ? "lb" : "oz",
    };
  }
  return {
    baseCents,
    baseUnit: "each" as const,
    displayCents: baseCents,
    displayUnit: "each",
  };
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
