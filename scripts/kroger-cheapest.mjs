import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { normalizeSearchOptions, run } from "../lib/kroger/core.mjs";

// Preserve existing script imports while all provider/database logic lives in the library.
export * from "../lib/kroger/core.mjs";

export const help = `Usage: npm run kroger:save -- --item "whole milk"
Options: --amount "12 ct" (prefer exact; otherwise within ±1/3), --category "Dairy",
--unit fl-oz|oz|each, --dry-run, --help
Location defaults to approximate IP location. Override with --lat and --lng,
or --zip for a ZIP representative point. Finds up to three KROGER stores
within 100 miles. Compares regular price per normalized unit for soldBy=UNIT.
Reuses today's saved item/store/amount records; older or undated records refresh.
Requires Kroger credentials and a Supabase key (read key for dry-run;
server write key for saves).`;

export function readOptions(args) {
  const { values } = parseArgs({
    args,
    options: {
      zip: { type: "string" },
      lat: { type: "string" },
      lng: { type: "string" },
      item: { type: "string" },
      unit: { type: "string" },
      category: { type: "string" },
      amount: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean" },
    },
  });
  if (values.help) return { help: true };
  const hasCoordinates = values.lat !== undefined || values.lng !== undefined;
  if (hasCoordinates && (values.lat === undefined || values.lng === undefined))
    throw new Error("Supply both --lat and --lng.");
  return normalizeSearchOptions({
    item: values.item,
    unit: values.unit,
    category: values.category,
    amount: values.amount,
    zip: values.zip,
    dryRun: values["dry-run"],
    ...(hasCoordinates
      ? { origin: { latitude: values.lat, longitude: values.lng } }
      : {}),
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const options = readOptions(process.argv.slice(2));
    if (options.help) console.log(help);
    else {
      // Use Next's existing env loader without adding a dependency.
      const require = createRequire(import.meta.url);
      const nextRequire = createRequire(require.resolve("next/package.json"));
      nextRequire("@next/env").loadEnvConfig(
        fileURLToPath(new URL("../", import.meta.url)),
        true,
      );
      const result = await run(options);
      if (!result.complete) process.exitCode = 2;
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}
