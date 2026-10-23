import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

const checker = resolve('scripts/security-check.mjs');
const pushHook = resolve('.githooks/pre-push');
const secret = 'test-only-credential-value-123456789';
function commit(cwd, message) {
  execFileSync('git', ['-c', 'user.name=Security Test', '-c', 'user.email=security@example.invalid', 'commit', '-qm', message], { cwd });
}
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
test('a credential in a deleted historical file is rejected without revealing its value', async () => workspace(async (cwd, run) => {
  await writeFile(join(cwd, 'removed-config.json'), JSON.stringify({ key: secret }));
  execFileSync('git', ['add', 'removed-config.json'], { cwd });
  commit(cwd, 'Record a test credential');
  execFileSync('git', ['rm', '-q', 'removed-config.json'], { cwd });
  commit(cwd, 'Remove the test credential');
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Git object [a-f0-9]+.*value redacted/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(secret));
}));
test('a credential reachable only through another Git ref is rejected', async () => workspace(async (cwd, run) => {
  await writeFile(join(cwd, 'README.md'), 'Public project\n');
  execFileSync('git', ['add', 'README.md'], { cwd });
  commit(cwd, 'Public initial commit');
  execFileSync('git', ['checkout', '-qb', 'private-history'], { cwd });
  await writeFile(join(cwd, 'branch-config.json'), JSON.stringify({ key: secret }));
  execFileSync('git', ['add', 'branch-config.json'], { cwd });
  commit(cwd, 'Test credential on another ref');
  execFileSync('git', ['checkout', '-q', '-'], { cwd });
  const result = run();
  assert.notEqual(result.status, 0);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(secret));
}));
test('a private environment file deleted from Git history is rejected', async () => workspace(async (cwd, run) => {
  await writeFile(join(cwd, '.env.local'), 'PUBLIC_LABEL=test-only-public-value\n');
  execFileSync('git', ['add', '-f', '.env.local'], { cwd });
  commit(cwd, 'Record a private environment file');
  execFileSync('git', ['rm', '-q', '.env.local'], { cwd });
  commit(cwd, 'Remove the private environment file');
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /private environment file.*Git history/);
}));
test('an access token in a deleted historical file is rejected', async () => workspace(async (cwd, run) => {
  const token = `Bearer eyJ${'a'.repeat(30)}`;
  await writeFile(join(cwd, 'removed-token.txt'), token);
  execFileSync('git', ['add', 'removed-token.txt'], { cwd });
  commit(cwd, 'Record a test token');
  execFileSync('git', ['rm', '-q', 'removed-token.txt'], { cwd });
  commit(cwd, 'Remove the test token');
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Git object [a-f0-9]+.*possible access token/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(token));
}));
test('clean committed history and an environment example are accepted', async () => workspace(async (cwd, run) => {
  await writeFile(join(cwd, 'README.md'), 'Public project\n');
  await writeFile(join(cwd, '.env.example'), 'TDX_CLIENT_SECRET=\n');
  execFileSync('git', ['add', 'README.md', '.env.example'], { cwd });
  commit(cwd, 'Public initial commit');
  const result = run();
  assert.equal(result.status, 0, result.stderr);
}));
test('the executable push hook checks the repository when invoked from a subdirectory', async () => workspace(async (cwd) => {
  await mkdir(join(cwd, 'scripts'));
  await copyFile(checker, join(cwd, 'scripts/security-check.mjs'));
  await mkdir(join(cwd, 'nested'));
  const result = spawnSync(pushHook, [], { cwd: join(cwd, 'nested'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
}));
test('the push hook blocks a credential exposed in the repository', async () => workspace(async (cwd) => {
  await mkdir(join(cwd, 'scripts'));
  await copyFile(checker, join(cwd, 'scripts/security-check.mjs'));
  await mkdir(join(cwd, 'nested'));
  await writeFile(join(cwd, 'exposed.json'), JSON.stringify({ key: secret }));
  const result = spawnSync(pushHook, [], { cwd: join(cwd, 'nested'), encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /value redacted/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(secret));
}));
