import { readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

const root = resolve('dist');
let html = await readFile(resolve(root, 'index.html'), 'utf8');
const assetPath = (url) => {
  const file = resolve(root, url.replace(/^\.\//, ''));
  if (relative(root, file).startsWith('..')) throw new Error('Build asset outside dist');
  return file;
};
const inlineScripts = [];
for (const match of [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>\s*<\/script>/g)]) {
  const script = (await readFile(assetPath(match[1]), 'utf8')).replace(/<\/script/gi, '<\\/script');
  inlineScripts.push(`<script>${script}</script>`);
  html = html.replace(match[0], '');
}
for (const match of [...html.matchAll(/<link\b[^>]*\bhref="([^"]+)"[^>]*>/g)]) {
  if (!/\brel="stylesheet"/.test(match[0])) continue;
  const css = (await readFile(assetPath(match[1]), 'utf8')).replace(/<\/style/gi, '<\\/style');
  html = html.replace(match[0], () => `<style>${css}</style>`);
}
html = html.replace('</body>', () => `${inlineScripts.join('\n')}\n</body>`);
if (/<script\b[^>]*\bsrc=|<link\b[^>]*\brel="stylesheet"|\btype="module"/.test(html)) {
  throw new Error('Standalone export still has external script/style/module references');
}
await writeFile(resolve(root, 'index.html'), html);
for (const entry of await readdir(root)) if (entry !== 'index.html') await rm(resolve(root, entry), { recursive: true });
console.log(`Standalone HTML ready: dist/index.html (${Math.round(Buffer.byteLength(html) / 1024)} KB)`);
