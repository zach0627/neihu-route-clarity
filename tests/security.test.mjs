import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

const checker = resolve('scripts/security-check.mjs');
const secret = 'test-only-credential-value-123456789';
async function workspace(fn) {
  const cwd = await mkdtemp(join(tmpdir(), 'neihu-security-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd });
    await mkdir(join(cwd, 'dist'));
    await writeFile(join(cwd, '.gitignore'), '.env\n.env.*\n!.env.example\n.credentials/\nresearch/\n');
    await writeFile(join(cwd, '.env.local'), `TDX_CLIENT_ID=test-only-account-id\nTDX_CLIENT_SECRET=${secret}\n`);
    await writeFile(join(cwd, 'dist/index.html'), '<html><body>Public data snapshot</body></html>');
    const run = () => spawnSync(process.execPath, [checker], { cwd, encoding: 'utf8' });
    await fn(cwd, run);
  } finally { await rm(cwd, { recursive: true, force: true }); }
}

test('local ignored credentials are accepted when exported data contains no secrets', async () => workspace(async (_cwd, run) => {
  const result = run(); assert.equal(result.status, 0, result.stderr);
}));
test('a credential accidentally embedded in dist fails the build without printing its value', async () => workspace(async (cwd, run) => {
  await writeFile(join(cwd, 'dist/index.html'), `<html>${secret}</html>`);
  const result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /value redacted/); assert.ok(!result.stderr.includes(secret));
}));
test('a credential in a Git-visible source file is rejected', async () => workspace(async (cwd, run) => {
  await writeFile(join(cwd, 'config.json'), JSON.stringify({ key: secret }));
  const result = run(); assert.notEqual(result.status, 0); assert.ok(!result.stderr.includes(secret));
}));
test('force-adding an ignored environment file is rejected', async () => workspace(async (cwd, run) => {
  execFileSync('git', ['add', '-f', '.env.local'], { cwd });
  const result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /environment file|Git ignore/);
}));
test('quoted environment values and comments are parsed consistently with Node dotenv loading', async () => workspace(async (cwd, run) => {
  await writeFile(join(cwd, '.env.local'), `TDX_CLIENT_SECRET="${secret}" # local only\n`);
  await writeFile(join(cwd, 'dist/index.html'), `<html>${secret}</html>`);
  const result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /value redacted/); assert.ok(!result.stderr.includes(secret));
}));
