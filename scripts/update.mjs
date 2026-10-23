import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { recentCalendarRange } from '../lib/ranking.mjs';

let args = process.argv.slice(2);
if (args.includes('--date')) {
  if (args.includes('--start') || args.includes('--end')) throw new Error('Use --date alone or --start/--end, not both');
  const at = args.indexOf('--date');
  const date = args[at + 1];
  if (!date) throw new Error('--date needs a YYYY-MM-DD value');
  args = [...args.slice(0, at), ...args.slice(at + 2), '--start', date, '--end', date];
}
const defaults = recentCalendarRange();
if (!args.includes('--start')) args.push('--start', defaults.start);
if (!args.includes('--end')) args.push('--end', defaults.end);
for (const script of ['download.mjs', 'download-sections.mjs', 'aggregate.mjs']) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...args], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
