// A deliberately small RFC 9309 matcher for the public catalog paths we request.
// If the file cannot be parsed or fetched, callers must fail closed.
export function robotsAllows(robots: string, url: string, agent = "Stretch") {
  const target = new URL(url);
  const path = target.pathname + target.search;
  const groups: {
    agents: string[];
    rules: { allow: boolean; pattern: string }[];
  }[] = [];
  let group: (typeof groups)[number] | undefined;
  for (const line of robots.split(/\r?\n/)) {
    const clean = line.split("#", 1)[0].trim();
    const match = clean.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key === "user-agent") {
      if (!group || group.rules.length) {
        group = { agents: [], rules: [] };
        groups.push(group);
      }
      group.agents.push(value.toLowerCase());
    } else if (
      (key === "allow" || key === "disallow") &&
      group?.agents.length &&
      value
    ) {
      group.rules.push({ allow: key === "allow", pattern: value });
    }
  }
  const name = agent.toLowerCase();
  const specific = groups.filter((g) =>
    g.agents.some((a) => a !== "*" && name.includes(a)),
  );
  const applicable = specific.length
    ? specific
    : groups.filter((g) => g.agents.includes("*"));
  if (!applicable.length) return false;
  let winner: { allow: boolean; length: number } | undefined;
  for (const rule of applicable.flatMap((g) => g.rules)) {
    const anchored = rule.pattern.endsWith("$");
    const body = anchored ? rule.pattern.slice(0, -1) : rule.pattern;
    const pattern = body
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    if (!new RegExp(`^${pattern}${anchored ? "$" : ""}`).test(path)) continue;
    const length = body.replaceAll("*", "").length;
    if (
      !winner ||
      length > winner.length ||
      (length === winner.length && rule.allow)
    )
      winner = { allow: rule.allow, length };
  }
  return winner?.allow ?? true;
}
