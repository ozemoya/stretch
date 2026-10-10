import { isIP } from "node:net";
import { normalizeIpLocation } from "../../../lib/detect-location";
let minute = 0,
  recent = 0,
  day = 0,
  total = 0;
export function publicIp(ip: unknown): ip is string {
  if (typeof ip !== "string" || !isIP(ip)) return false;
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0)
    );
  }
  // Only global-unicast IPv6, avoiding mapped loopback/private addresses.
  return /^[23][0-9a-f]{0,3}:/i.test(ip) && !/^2001:db8:/i.test(ip);
}
export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > 256)
    return Response.json({ error: "Invalid lookup." }, { status: 400 });
  let ip: unknown;
  try {
    ip = JSON.parse(text).ip;
  } catch {
    /* invalid JSON */
  }
  if (!publicIp(ip))
    return Response.json(
      { error: "A public IP address is required." },
      { status: 400 },
    );
  const now = Date.now(),
    m = Math.floor(now / 60000),
    d = Math.floor(now / 86400000);
  if (minute !== m) {
    minute = m;
    recent = 0;
  }
  if (day !== d) {
    day = d;
    total = 0;
  }
  if (recent >= 20 || total >= 100)
    return Response.json(
      { error: "IP lookup is busy. Choose an area manually." },
      { status: 429 },
    );
  recent++;
  total++;
  try {
    const r = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!r.ok) throw new Error();
    return Response.json(normalizeIpLocation(await r.json()), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "IP lookup unavailable. Choose an area manually." },
      { status: 502 },
    );
  }
}
