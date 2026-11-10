// Shared by normal frontend builds and local release preparation. Never stores source or env values.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

export const digest = value => createHash('sha256').update(value).digest('hex');
export const hashFile = async path => digest(await readFile(path));
export async function readJSON(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
}
export async function saveJSON(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
}
export function npm(root, args, options = {}) {
  // Only fixed arguments supplied by our build scripts, never arbitrary shell text.
  return process.platform === 'win32'
    ? execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`], { cwd: root, windowsHide: true, encoding: 'utf8', ...options })
    : execFileSync('npm', args, { cwd: root, windowsHide: true, encoding: 'utf8', ...options });
}
export async function outputHashes(path) {
  const hashes = {};
  async function visit(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Unexpected symlink in frontend output.');
      const file = join(folder, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) hashes[relative(path, file).replaceAll('\\', '/')] = await hashFile(file);
    }
  }
  await visit(path);
  return Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)));
}
export async function outputsMatch(path, expected) {
  if (!expected || !Object.keys(expected).length) return false;
  try { return JSON.stringify(await outputHashes(path)) === JSON.stringify(expected); }
  catch { return false; }
}
export async function dependencyState(root, npmVersion) {
  const frontend = join(root, 'frontend');
  const toolchain = { nodeVersion: process.version, npmVersion, platform: process.platform, arch: process.arch };
  const inputs = { lock: await hashFile(join(frontend, 'package-lock.json')),
    packageHash: await hashFile(join(frontend, 'package.json')), nodeVersion: process.version,
    platform: process.platform, arch: process.arch };
  const key = digest(JSON.stringify({ ...inputs, npmVersion }));
  let installedLock = null;
  try { installedLock = await hashFile(join(frontend, 'node_modules', '.package-lock.json')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  // npm may resolve differently inside nested npm scripts. The actual compiler input is
  // the installed lock plus Node/platform; a different npm only revalidates installation.
  const buildKey = digest(JSON.stringify({ ...inputs, installedLock }));
  return { key, buildKey, installedLock, ...toolchain };
}
export async function installedDependenciesMatch(root, state) {
  const saved = await readJSON(join(root, '.local/release-cache/dependencies.json'));
  return Boolean(state.installedLock && saved?.key === state.key && saved.installedLock === state.installedLock);
}
export async function rememberDependencies(root, state) {
  if (!state.installedLock) throw new Error('Missing installed dependency lock; run npm ci in frontend.');
  await saveJSON(join(root, '.local/release-cache/dependencies.json'), state);
}
// A successful build alone cannot establish that installed packages match the lockfile.
export async function adoptInstalledDependencies(root, state) {
  if (!state.installedLock) return false;
  const frontend = join(root, 'frontend');
  const locked = await readJSON(join(frontend, 'package-lock.json'));
  const installed = await readJSON(join(frontend, 'node_modules/.package-lock.json'));
  if (!locked?.packages || !installed?.packages) return false;
  for (const [path, value] of Object.entries(installed.packages)) {
    if (!path) continue;
    const expected = locked.packages[path];
    if (!expected || ['version', 'resolved', 'integrity', 'link'].some(key => value[key] !== expected[key])) return false;
  }
  try { npm(frontend, ['ls', '--all', '--offline'], { stdio: 'pipe' }); }
  catch { return false; }
  await rememberDependencies(root, state);
  return true;
}
export async function frontendState(root, dependenciesKey, environment = process.env) {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--',
    'frontend/src', 'frontend/public', 'frontend/index.html', 'frontend/vite.config.*', 'frontend/tsconfig*.json',
    'frontend/package.json', 'frontend/package-lock.json', 'frontend/scripts',
    'scripts/lib/frontend-build.mjs', 'frontend/.npmrc', '.npmrc',
  ], { cwd: root, encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean);
  const inputs = [];
  for (const file of [...new Set(files)].sort()) {
    let sha;
    try { sha = await hashFile(join(root, file)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; sha = null; }
    inputs.push([file, sha]);
  }
  const env = Object.entries(environment).filter(([name]) => name.startsWith('VITE_') || name === 'NODE_ENV').sort(([a], [b]) => a.localeCompare(b));
  return { key: digest(JSON.stringify({ version: 1, dependenciesKey, inputs, env })) };
}
export async function rememberFrontend(root, state) {
  const outputs = await outputHashes(join(root, 'frontend/dist'));
  if (!outputs['index.html']) throw new Error('Frontend build did not produce index.html.');
  const receipt = { key: state.key, outputs };
  await saveJSON(join(root, '.local/release-cache/frontend.json'), receipt);
  return receipt;
}
export async function reusableFrontend(root, state) {
  const receipt = await readJSON(join(root, '.local/release-cache/frontend.json'));
  if (receipt?.key !== state.key) return null;
  if (!await outputsMatch(join(root, 'frontend/dist'), receipt.outputs)) return null;
  if (!await outputsMatch(join(root, 'web/studio'), receipt.outputs)) return null;
  return receipt;
}
