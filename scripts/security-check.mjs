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
const checkContent = (content, location) => {
  for (const [key, secret] of Object.entries(credentials)) {
    if (secret.length >= 8 && content.includes(Buffer.from(secret))) throw new Error(`${location} contains a local credential (${key}; value redacted)`);
  }
  if (/Bearer\s+eyJ[A-Za-z0-9_-]{20}/.test(content.toString())) throw new Error(`${location} contains a possible access token`);
};
const check = async (file) => checkContent(await readFile(file), file);
const isPrivateEnvironment = (file) => /(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.env.example');
const historyGit = (args, options = {}) => {
  try { return execFileSync('git', args, { stdio: 'pipe', maxBuffer: 128 * 1024 * 1024, ...options }); }
  catch { throw new Error('Unable to inspect Git history safely'); }
};
const checkHistory = () => {
  const ids = historyGit(['rev-list', '--objects', '--all', '--no-object-names'], { encoding: 'utf8' });
  if (!ids.trim()) return;
  const objects = historyGit(['cat-file', '--batch-check'], { input: ids, encoding: 'utf8' }).trim().split('\n').map((line) => line.split(' '));
  for (const [id, type] of objects) {
    if (type !== 'tree') continue;
    const entries = historyGit(['ls-tree', '-z', id], { encoding: 'utf8' }).split('\0').filter(Boolean);
    if (entries.some((entry) => isPrivateEnvironment(entry.slice(entry.indexOf('\t') + 1)))) {
      throw new Error(`A private environment file exists in Git history (Git object ${id})`);
    }
  }
  for (const [id, type] of objects) {
    if (type === 'blob') checkContent(historyGit(['cat-file', 'blob', id]), `Git object ${id}`);
  }
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
  if (tracked.some(isPrivateEnvironment)) throw new Error('A private environment file is already tracked by Git');
  const visible = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const file of visible) { try { await check(file); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  checkHistory();
  const exactScan = Object.values(credentials).filter((value) => value.length >= 8).length;
  console.log(`Security check passed: ${files.length} built file(s) in dist and dist-pages, Git-visible source files, all Git refs and history, and ignore rules. ${exactScan ? `Exact matching against ${exactScan} local credential values performed.` : 'No local credentials configured; token patterns and ignore rules checked only.'}`);
} catch (error) {
  if (error.status === 128) throw new Error('Initialize the local Git repository before validating ignore protection');
  throw error;
}
