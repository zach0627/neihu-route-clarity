// Finish the GitHub Pages build: add the latest live.json (if the scheduled job produced one) and disable Jekyll.
import { copyFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const out = resolve('dist-pages');
await writeFile(resolve(out, '.nojekyll'), '');
try {
  await access(resolve('data/live.json'));
  await copyFile(resolve('data/live.json'), resolve(out, 'live.json'));
  console.log('GitHub Pages build ready: dist-pages (with live.json)');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.log('GitHub Pages build ready: dist-pages (no live.json yet; the page shows the historical snapshot)');
}
