// Local preparation only. This script has no push, SSH, upload, or deployment step.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frontend = join(root, 'frontend');
const cacheDir = join(root, '.local', 'release-cache');
const run = (command, args, options = {}) => execFileSync(command, args, {
  cwd: root, windowsHide: true, encoding: 'utf8', ...options,
});
function npm(args, options = {}) {
  // Arguments are fixed by this script, never interpolated from user input.
  return process.platform === 'win32'
    ? run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`], options)
    : run('npm', args, options);
}
const digest = value => createHash('sha256').update(value).digest('hex');
async function hashFile(path) { return digest(await readFile(path)); }
async function readJSON(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}
async function saveJSON(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
}
async function filesBelow(path) {
  const result = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in build output: ${entry.name}`);
    const child = join(path, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(child));
    else if (entry.isFile()) result.push(child);
  }
  return result.sort();
}
async function outputHashes(path) {
  const hashes = {};
  for (const file of await filesBelow(path)) hashes[relative(path, file).replaceAll('\\', '/')] = await hashFile(file);
  return hashes;
}
async function outputsMatch(path, expected) {
  if (!expected || !Object.keys(expected).length) return false;
  try { return JSON.stringify(await outputHashes(path)) === JSON.stringify(expected); }
  catch { return false; }
}

if (process.argv.length !== 2) throw new Error('Usage: node scripts/prepare-release.mjs (local preparation only)');
if (run('git', ['status', '--porcelain', '--untracked-files=normal']).trim()) {
  throw new Error('Commit or preserve pending changes before preparing a release; nothing was pushed or deployed.');
}
const commit = run('git', ['rev-parse', 'HEAD']).trim();
const nodeVersion = process.version;
const npmVersion = npm(['--version']).trim();
const goVersion = run('go', ['version']).trim();
const lock = await hashFile(join(frontend, 'package-lock.json'));
const packageHash = await hashFile(join(frontend, 'package.json'));
const dependenciesKey = digest(JSON.stringify({ lock, packageHash, nodeVersion, npmVersion, platform: process.platform, arch: process.arch }));
const dependencyFile = join(cacheDir, 'dependencies.json');
const dependencies = await readJSON(dependencyFile);
const installedLockPath = join(frontend, 'node_modules', '.package-lock.json');
let dependenciesValid = dependencies?.key === dependenciesKey;
try {
  dependenciesValid &&= dependencies.installedLock === await hashFile(installedLockPath);
  await stat(join(frontend, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite'));
  await stat(join(frontend, 'node_modules', 'typescript', 'bin', 'tsc'));
} catch { dependenciesValid = false; }
if (!dependenciesValid) {
  npm(['ci'], { cwd: frontend, stdio: 'inherit' });
  await saveJSON(dependencyFile, { key: dependenciesKey, installedLock: await hashFile(installedLockPath) });
} else console.log('Dependencies unchanged: reused installed packages.');

const inputs = run('git', ['ls-files', '-z', '--',
  'frontend/src', 'frontend/public', 'frontend/index.html', 'frontend/vite.config.ts',
  'frontend/tsconfig.json', 'frontend/package.json', 'frontend/package-lock.json',
  'frontend/scripts/sync-server.mjs', 'frontend/.npmrc', '.npmrc',
]).split('\0').filter(Boolean).sort();
const inputHashes = [];
for (const file of inputs) inputHashes.push([file, await hashFile(join(root, file))]);
const frontendKey = digest(JSON.stringify({ dependenciesKey, inputs: inputHashes }));
const frontendCacheFile = join(cacheDir, 'frontend.json');
let frontendCache = await readJSON(frontendCacheFile);
let frontendValid = frontendCache?.key === frontendKey;
frontendValid &&= await outputsMatch(join(frontend, 'dist'), frontendCache?.outputs);
frontendValid &&= await outputsMatch(join(root, 'web', 'studio'), frontendCache?.outputs);
if (!frontendValid) {
  npm(['run', 'build:server'], { cwd: frontend, stdio: 'inherit' });
  frontendCache = { key: frontendKey, outputs: await outputHashes(join(frontend, 'dist')) };
  if (!await outputsMatch(join(root, 'web', 'studio'), frontendCache.outputs)) throw new Error('Embedded frontend differs from dist.');
  await saveJSON(frontendCacheFile, frontendCache);
} else console.log('Frontend inputs and output checksums unchanged: reused build.');

const releaseDir = join(root, 'outputs', 'releases', commit);
const binary = join(releaseDir, 'img-gen-linux-amd64');
const manifestPath = join(releaseDir, 'release.json');
const flags = ['-trimpath', '-ldflags=-s -w'];
const binaryKey = digest(JSON.stringify({ commit, goVersion, frontendKey, flags, platform: 'linux/amd64', cgo: '0' }));
const previous = await readJSON(manifestPath);
let binaryValid = previous?.buildKey === binaryKey;
try { binaryValid &&= previous.sha256 === await hashFile(binary); } catch { binaryValid = false; }
if (!binaryValid) {
  await mkdir(releaseDir, { recursive: true });
  run('go', ['build', ...flags, '-o', binary, '.'], {
    env: { ...process.env, CGO_ENABLED: '0', GOOS: 'linux', GOARCH: 'amd64' }, stdio: 'inherit',
  });
} else console.log('Same source commit and binary checksum: reused Linux release.');

// Do not publish a release identity if an editor changed source during preparation.
if (run('git', ['rev-parse', 'HEAD']).trim() !== commit || run('git', ['status', '--porcelain', '--untracked-files=normal']).trim()) {
  throw new Error('Source changed while preparing; no release manifest was published.');
}
await saveJSON(manifestPath, {
  commit, buildKey: binaryKey, sha256: await hashFile(binary), platform: 'linux/amd64',
  binary: relative(root, binary).replaceAll('\\', '/'), nodeVersion, npmVersion, goVersion,
  frontendFiles: frontendCache.outputs, preparedAt: new Date().toISOString(),
  localOnly: true, testsRun: false,
});
console.log(`Release prepared locally: ${manifestPath}`);
console.log('No push, upload, or deployment performed.');
