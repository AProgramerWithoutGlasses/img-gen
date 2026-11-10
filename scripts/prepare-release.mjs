// Local preparation only. This script has no push, SSH, upload, or deployment step.
import { execFileSync } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adoptInstalledDependencies, dependencyState, digest, frontendState, hashFile, installedDependenciesMatch,
  npm, readJSON, rememberDependencies, reusableFrontend, saveJSON } from './lib/frontend-build.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frontend = join(root, 'frontend');
const run = (command, args, options = {}) => execFileSync(command, args, {
  cwd: root, windowsHide: true, encoding: 'utf8', ...options,
});

if (process.argv.length !== 2) throw new Error('Usage: node scripts/prepare-release.mjs (local preparation only)');
if (run('git', ['status', '--porcelain', '--untracked-files=normal']).trim()) {
  throw new Error('Commit or preserve pending changes before preparing a release; nothing was pushed or deployed.');
}
const commit = run('git', ['rev-parse', 'HEAD']).trim();
const nodeVersion = process.version;
const npmVersion = npm(root, ['--version']).trim();
const goVersion = run('go', ['version']).trim();
let dependencies = await dependencyState(root, npmVersion);
let dependenciesValid = await installedDependenciesMatch(root, dependencies)
  || await adoptInstalledDependencies(root, dependencies);
try {
  await stat(join(frontend, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite'));
  await stat(join(frontend, 'node_modules', 'typescript', 'bin', 'tsc'));
} catch { dependenciesValid = false; }
if (!dependenciesValid) {
  npm(frontend, ['ci'], { stdio: 'inherit' });
  dependencies = await dependencyState(root, npmVersion);
  await rememberDependencies(root, dependencies);
} else console.log('Dependencies unchanged: reused installed packages.');

const frontendInputs = await frontendState(root, dependencies.buildKey);
const frontendKey = frontendInputs.key;
let frontendCache = await reusableFrontend(root, frontendInputs);
if (!frontendCache) {
  npm(frontend, ['run', 'build:server'], { stdio: 'inherit' });
  frontendCache = await reusableFrontend(root, frontendInputs);
  if (!frontendCache) throw new Error('Frontend inputs or embedded output changed during build; no release was prepared.');
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
