// Synthetic browser fixture is built in a temporary directory. It never changes public data or dist.
import { chromium } from '@playwright/test';
import { mkdtemp, mkdir, cp, symlink, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = resolve('.');
const temp = await mkdtemp(join(tmpdir(), 'neihu-ui-fixture-'));
let browser;
try {
  for (const directory of ['src', 'lib']) await cp(join(root, directory), join(temp, directory), { recursive: true });
  for (const file of ['index.html', 'vite.config.js', 'package.json']) await cp(join(root, file), join(temp, file));
  await symlink(join(root, 'node_modules'), join(temp, 'node_modules'), 'dir');
  await mkdir(join(temp, 'data'));
  const fixture = JSON.parse(await readFile(join(root, 'data/dashboard.json'), 'utf8'));
  const date = '2026-10-22';
  fixture.coverage = { requestedDates: [date], availableDates: [date], failedDates: [], pendingDates: [], commonDates: [date], status: 'complete' };
  fixture.meta.requestedStart = date; fixture.meta.requestedEnd = date;
  fixture.directions = Array.from({ length: 11 }, (_, index) => {
    const validMinutes = index === 9 ? 149 : 100;
    return { id: `TEST${index}:LINK${index}`, vdId: `TEST${index}`, linkId: `LINK${index}`, roadName: `瀏覽器測試道路${index}`, bearing: 'N', scope: { included: true, status: 'proposed', reason: 'Synthetic browser test only' }, days: [{ date, receivedMinutes: 150, validMinutes, volume: (index + 1) * validMinutes, reasonCounts: { error_diag: 150 - validMinutes } }] };
  });
  fixture.summary = { stations: 11, directions: 11, inScopeDirections: 11, qualifiedDirections: 0, observedComparableDirections: 11 };
  await writeFile(join(temp, 'data/dashboard.json'), JSON.stringify(fixture));
  execFileSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: temp, stdio: 'pipe' });
  execFileSync(process.execPath, [join(root, 'scripts/standalone.mjs')], { cwd: temp, stdio: 'pipe' });
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const context = await browser.newContext({ offline: true, acceptDownloads: true });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  await page.goto(`${pathToFileURL(join(temp, 'dist/index.html')).href}#ranking`);
  await page.locator('.ranking-table').waitFor();
  assert.equal(await page.locator('.ranking-table tbody tr').count(), 10);
  assert.match(await page.locator('.stat-card').filter({ hasText: '有實測資料可比較' }).locator('.stat-value').innerText(), /11/);
  assert.ok((await page.locator('.ranking-table tbody tr').first().innerText()).includes('瀏覽器測試道路10'));
  assert.ok((await page.locator('.ranking-table thead').innerText()).includes('每有效分鐘平均'));
  const wait = page.waitForEvent('download');
  await page.getByRole('button', { name: '匯出 CSV' }).click();
  const download = await wait;
  const csv = await readFile(await download.path(), 'utf8');
  assert.equal(csv.charCodeAt(0), 0xFEFF, 'Excel export includes UTF-8 BOM');
  assert.equal(csv.trim().split(/\r?\n/).length, 11, 'CSV is header plus top ten');
  assert.ok(csv.includes('瀏覽器測試道路10'));
  assert.ok(!csv.includes('瀏覽器測試道路0"'));
  assert.ok(csv.includes('有效分鐘'));
  assert.ok(!csv.includes('平均每日車次'));
  console.log('Synthetic ranking UI passed: 11 partially observed directions counted, ten rows ordered by per-minute means rather than total counts, ten CSV rows with Excel encoding; public data untouched.');
} finally {
  if (browser) await browser.close();
  await rm(temp, { recursive: true, force: true });
}
