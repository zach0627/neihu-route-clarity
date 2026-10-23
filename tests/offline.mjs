import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildObservedRankings, buildRankings, buildCongestionRankings, representativeDirections } from '../lib/ranking.mjs';
import { buildFlexRecommendations, minuteText, parseMinute } from '../lib/flex.mjs';
import { heatmapRows, parkPeriods, dailySeries } from '../lib/dashboard.mjs';

const snapshot = JSON.parse(await readFile('data/dashboard.json', 'utf8'));
const portable = await mkdtemp(join(tmpdir(), 'neihu-portable-'));
await copyFile('dist/index.html', join(portable, 'index.html'));
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, offline: true });
const network = [], errors = [];
context.on('request', (request) => { if (/^https?:/.test(request.url())) network.push(request.url()); });
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto(pathToFileURL(join(portable, 'index.html')).href);
  await page.getByRole('heading', { name: '內湖科技園區早尖峰總覽' }).waitFor();
  {
    const dates = snapshot.coverage.availableDates;
    const rows = heatmapRows(snapshot.directions, dates);
    assert.equal(await page.locator('.heatmap tbody tr').count(), rows.length + 1, 'Heatmap shows every ranked segment plus the park total');
    const peak = parkPeriods(rows).reduce((best, period) => (period.share ?? -1) > (best?.share ?? -1) ? period : best, null);
    assert.ok((await page.locator('.dashboard-kpis').innerText()).includes(minuteText(peak.start)), 'Peak 15-minute period KPI matches the shared calculation');
    assert.equal(await page.locator('.bar-chart').count() >= 4, true, 'Period, daily and weekday charts render');
    const holidays = dailySeries(snapshot.directions, dates, snapshot.holidays?.dates || []).filter((day) => day.holiday);
    assert.equal(await page.locator('#daily-heading').locator('xpath=../../..').locator('.bar-note').count(), holidays.length * 2, 'Each holiday is labelled in both daily charts');
    assert.ok((await page.locator('main').innerText()).includes('離線示範版'), 'Standalone build says it is the offline demo');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: resolve('artifacts/dashboard-desktop.png'), fullPage: true });
  }
  await page.getByRole('button', { name: '車流觀測', exact: true }).first().click();
  await page.getByRole('heading', { name: /早上的車流/ }).waitFor();
  assert.equal(await page.title(), '內湖園區搞清楚要走的路');
  assert.equal(await page.locator('.date-select option').count(), snapshot.coverage.availableDates.length + 1);
  const dates = snapshot.coverage.availableDates;
  const compared = buildObservedRankings(snapshot.directions, dates, { limit: Infinity });
  const strictCount = buildRankings(snapshot.directions, dates, { limit: Infinity }).length;
  assert.equal(await page.locator('.ranking-table tbody tr').count(), Math.min(10, compared.length));
  assert.match(await page.locator('.stat-card').filter({ hasText: '有實測資料可比較' }).locator('.stat-value').innerText(), new RegExp(String(compared.length)));
  assert.ok((await page.locator('.ranking-table thead').innerText()).includes('每有效分鐘平均車次'));
  assert.ok(!(await page.locator('.ranking-table thead').innerText()).includes('平均每日車次'));
  assert.ok((await page.locator('.completeness-section').innerText()).includes(`嚴格完整資料條件：${strictCount} 個方向符合`));
  const format = value => new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 }).format(value);
  const representatives = representativeDirections(snapshot.directions);
  const best = representatives.map(direction => ({ direction, valid: dates.reduce((sum, date) => sum + (direction.days.find(day => day.date === date)?.validMinutes || 0), 0) })).sort((a, b) => b.valid - a.valid)[0];
  if (best) {
    const evidence = await page.locator('.best-completeness').innerText();
    assert.ok(evidence.includes(best.direction.roadName), 'Completeness evidence names the best entire-period direction');
    assert.ok(evidence.includes(`${format(best.valid)} / ${format(dates.length * 150)}`), 'Completeness denominator uses every selected date, not the best single day');
    await page.getByRole('button', { name: '查看最完整方向明細' }).click();
    assert.ok((await page.getByRole('dialog').innerText()).includes(best.direction.vdId));
    assert.equal(await page.locator('.daily-detail').count(), dates.length);
    await page.getByRole('button', { name: '關閉測點明細' }).click();
  }
  const sharedGapDates = dates.filter(date => representatives.length && representatives.every(direction => (direction.days.find(day => day.date === date)?.receivedMinutes || 0) < 150));
  assert.equal(await page.locator('.shared-gap-item').count(), sharedGapDates.length);
  for (const date of sharedGapDates) assert.ok((await page.locator('.shared-gaps').innerText()).includes(date.replaceAll('-', '/')));
  if (compared.length) {
    const firstRow = await page.locator('.ranking-table tbody tr').first().innerText();
    assert.ok(firstRow.includes(compared[0].roadName));
    assert.ok(firstRow.includes(new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(compared[0].totalObservedVolume / compared[0].validMinutes)), 'Displayed rate divides real measured counts by valid minutes');
    const csvPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '匯出 CSV' }).click();
    const csv = await readFile(await (await csvPromise).path(), 'utf8');
    assert.ok(csv.includes('每有效分鐘平均車次'));
    assert.ok(csv.includes('可用日期完整度%'));
    assert.ok(csv.includes('要求期間完整度%'));
    assert.ok(!csv.includes('平均每日車次'));
    assert.equal(csv.trim().split(/\r?\n/).length, Math.min(10, compared.length) + 1);
  }
  const congestion = buildCongestionRankings(snapshot.directions, dates, { limit: Infinity });
  if (congestion.length) {
    assert.equal(await page.locator('.congestion-table tbody tr').count(), Math.min(10, congestion.length));
    const firstCongested = await page.locator('.congestion-table tbody tr').first().innerText();
    assert.ok(firstCongested.includes(congestion[0].roadName), 'Congestion Top 10 is ordered by the shared calculation');
    assert.ok(firstCongested.includes(new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(congestion[0].congestedShare)), 'Displayed share is congested minutes ÷ classified minutes');
    assert.ok(snapshot.directions.filter(direction => congestion.some(row => row.id === direction.id)).every(direction => direction.scope.included && ['entering', 'internal'].includes(direction.scope.category)), 'Only park-bound segments are ranked for congestion');
    const congestionCsv = page.waitForEvent('download');
    await page.getByRole('button', { name: '匯出塞車 CSV' }).click();
    const text = await readFile(await (await congestionCsv).path(), 'utf8');
    assert.equal(text.charCodeAt(0), 0xFEFF);
    assert.ok(text.includes('壅塞分鐘比例'));
    assert.equal(text.trim().split(/\r?\n/).length, Math.min(10, congestion.length) + 1);
  }
  assert.ok(compared.every(row => ['entering', 'internal'].includes(row.scope?.category) || !snapshot.summary.categories), 'Only park-bound segments are ranked for volume');
  if (snapshot.meta.park?.extent) {
    const extent = await page.locator('.extent-section').innerText();
    for (const place of ['north', 'south', 'east']) assert.ok(extent.includes(snapshot.meta.park.extent[place].address.replace(/^臺北市內湖區.{2}里/, '')), `Park extent names the official ${place}most address`);
    for (const road of snapshot.meta.park.extent.boundaryRoads) assert.ok(extent.includes(road.road), `Boundary road ${road.road} is listed`);
    assert.ok(await page.locator('.scope-map-extent .map-labels text').count() >= 5, 'Extent map labels the roads');
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve('artifacts/ranking-desktop.png'), fullPage: true });
  await page.getByRole('textbox', { name: '搜尋路名或測點編號' }).fill('港墘路');
  assert.ok(await page.locator('.audit-table tbody tr').count() > 0);
  await page.locator('.audit-table button').first().click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: '關閉測點明細' }).click();
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.getByRole('button', { name: '資料來源與計算', exact: true }).first().click();
  await page.getByRole('heading', { name: '我們呼叫哪些 API？' }).waitFor();
  assert.ok((await page.locator('main').innerText()).includes('/Historical/Road/Traffic/Live/VD/City/Taipei'));
  assert.ok((await page.locator('main').innerText()).includes('DataCollectTime'));
  assert.ok((await page.locator('main').innerText()).includes('實測累計車次 ÷ 有效分鐘數'));
  assert.ok((await page.locator('main').innerText()).includes('各方向的有效時刻可能不同'));
  assert.equal(await page.locator('.date-tile').count(), snapshot.coverage.requestedDates.length);
  if (snapshot.summary.categories) {
    assert.ok((await page.locator('main').innerText()).includes('「往園區路段」怎麼判定？'));
    assert.ok((await page.locator('main').innerText()).includes(snapshot.meta.park.boundarySource.officialText));
  }
  if (snapshot.meta.congestionLevels?.length) {
    assert.ok((await page.locator('main').innerText()).includes('塞車怎麼算？'));
    assert.ok(await page.locator('.level-table').count() >= 1);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve('artifacts/methodology-desktop.png'), fullPage: true });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '下載分析 JSON' }).click();
  const download = await downloadPromise;
  const file = await download.path();
  const exported = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(exported.meta.title, snapshot.meta.title);
  assert.deepEqual(exported.coverage.availableDates, snapshot.coverage.availableDates);
  const company = snapshot.companies?.list?.[0];
  if (company) {
    await page.getByRole('button', { name: '彈性上班建議', exact: true }).first().click();
    await page.locator('.direction-card').first().waitFor();
    assert.equal(await page.locator('.direction-card').count(), 4, 'North, east, south and west cards');
    const expected = buildFlexRecommendations(company.location, snapshot.directions, snapshot.coverage.availableDates, { baselineMinute: parseMinute(snapshot.companies.defaults.baselineStart) });
    const summary = await page.locator('.flex-summary tbody').innerText();
    for (const rec of expected) assert.ok(summary.includes(minuteText(rec.recommendedMinute)), `${rec.name} recommendation ${minuteText(rec.recommendedMinute)} is shown`);
    const flexText = await page.locator('main').innerText();
    assert.ok(flexText.includes('/api/basic/v2/Road/Traffic/Live/VD/City/Taipei'), 'The 15-minute update names the live API');
    assert.ok(flexText.includes(company.location.matchedAddress), 'The official geocoded address is shown');
    const flexCsv = page.waitForEvent('download');
    await page.getByRole('button', { name: '匯出建議 CSV' }).click();
    const csvText = await readFile(await (await flexCsv).path(), 'utf8');
    assert.equal(csvText.trim().split(/\r?\n/).length, 5, 'Header plus four directions');
    await page.getByRole('combobox', { name: '標準上班時間' }).selectOption('09:00');
    const later = buildFlexRecommendations(company.location, snapshot.directions, snapshot.coverage.availableDates, { baselineMinute: parseMinute('09:00') });
    assert.ok((await page.locator('.flex-summary tbody').innerText()).includes(minuteText(later[0].recommendedMinute)));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: resolve('artifacts/flex-desktop.png'), fullPage: true });
  }
  await page.getByRole('button', { name: '車流觀測', exact: true }).click();
  if (snapshot.coverage.availableDates.length) {
    await page.getByRole('combobox', { name: '選擇分析日期' }).selectOption(snapshot.coverage.availableDates[0]);
    assert.ok((await page.locator('.completeness-baselines > div').last().innerText()).includes('1 日 × 150 = 150 分鐘'));
    for (const expected of await page.locator('.observed-quality-cell > span').allTextContents()) assert.ok(expected.includes('/ 150 分鐘'), 'Single-date comparison uses a 150-minute expected denominator');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile page must not overflow horizontally');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve('artifacts/ranking-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: '資料來源與計算', exact: true }).first().click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile methodology must not overflow horizontally');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve('artifacts/methodology-mobile.png'), fullPage: true });
  assert.deepEqual(errors, [], 'No browser runtime errors');
  assert.deepEqual(network, [], 'Standalone file must not request any remote resource');
  console.log(`Offline file:// verification passed: measured-minute Top 10, strict completeness evidence, CSV/JSON exports, copied HTML alone, desktop/mobile, both pages and single-day filters. ${snapshot.coverage.availableDates.length}/${snapshot.coverage.requestedDates.length} dates; no network requests or browser errors.`);
} finally {
  await browser.close();
  await rm(portable, { recursive: true, force: true });
}
