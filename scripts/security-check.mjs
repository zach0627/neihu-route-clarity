import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';

const credentials = {};
try {
  const env = await readFile('.env.local', 'utf8');
  const parsed = parseEnv(env);
  for (const key of ['TDX_CLIENT_ID', 'TDX_CLIENT_SECRET']) if (parsed[key]) credentials[key] = parsed[key];
} catch (error) { if (error.code !== 'ENOENT') throw error; }
for (const key of ['TDX_CLIENT_ID', 'TDX_CLIENT_SECRET']) if (process.env[key]) credentials[`${key} (environment)`] = process.env[key];
const walk = async (dir) => {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path)); else files.push(path);
  }
  return files;
};
const check = async (file) => {
  const content = await readFile(file);
  for (const [key, secret] of Object.entries(credentials)) {
    if (secret.length >= 8 && content.includes(Buffer.from(secret))) throw new Error(`${file} contains a local credential (${key}; value redacted)`);
  }
  if (/Bearer\s+eyJ[A-Za-z0-9_-]{20}/.test(content.toString())) throw new Error(`${file} contains a possible access token`);
};
let files = [];
for (const out of ['dist', 'dist-pages']) {
  try { files.push(...await walk(resolve(out))); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
for (const file of files) await check(file);
try {
  execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'pipe' });
  for (const privateFile of ['.env.local', '.credentials/tdx.env', 'research/private.json']) {
    try { execFileSync('git', ['check-ignore', '-q', privateFile], { stdio: 'pipe' }); }
    catch { throw new Error(`Git ignore does not protect ${privateFile}`); }
  }
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  if (tracked.some((f) => /(^|\/)\.env(?:\.|$)/.test(f) && !f.endsWith('.env.example'))) throw new Error('A private environment file is already tracked by Git');
  const visible = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const file of visible) { try { await check(file); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  const exactScan = Object.values(credentials).filter((value) => value.length >= 8).length;
  console.log(`Security check passed: ${files.length} built file(s) in dist and dist-pages, Git-visible source files, and ignore rules. ${exactScan ? `Exact matching against ${exactScan} local credential values performed.` : 'No local credentials configured; token patterns and ignore rules checked only.'}`);
} catch (error) {
  if (error.status === 128) throw new Error('Initialize the local Git repository before validating ignore protection');
  throw error;
}
