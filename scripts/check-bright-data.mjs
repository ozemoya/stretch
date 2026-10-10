// Read-only: checks the existing test job without spending more scrape credits.
import { readFile, writeFile } from 'node:fs/promises';
const key = process.env.BRIGHT_DATA_API_KEY;
if (!key) throw new Error('Load .env.local before running this script.');
const job = JSON.parse(await readFile('bright-data-test.json', 'utf8'));
if (!/^sd_[a-z0-9]+$/.test(job.snapshot_id ?? '')) throw new Error('No saved job ID.');
const headers = { Authorization: `Bearer ${key}` };
const progress = await fetch(`https://api.brightdata.com/datasets/v3/progress/${job.snapshot_id}`, { headers, signal: AbortSignal.timeout(20000) });
if (!progress.ok) throw new Error(`Provider status check failed: ${progress.status}`);
const state = await progress.json();
console.log('Walmart test:', state.status);
if (state.status === 'failed') console.log(state.error_message ?? 'Provider job failed.');
if (state.status === 'ready') {
  const result = await fetch(`https://api.brightdata.com/datasets/v3/snapshot/${job.snapshot_id}?format=json`, { headers, signal: AbortSignal.timeout(30000) });
  if (!result.ok) throw new Error(`Download failed: ${result.status}`);
  const records = await result.json();
  await writeFile('bright-data-results.json', JSON.stringify(records, null, 2));
  console.log('Results saved locally for store and price validation.');
}
