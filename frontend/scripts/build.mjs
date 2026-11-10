import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adoptInstalledDependencies, dependencyState, frontendState, installedDependenciesMatch, npm, rememberFrontend } from '../../scripts/lib/frontend-build.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const frontend = join(root, 'frontend');
if (process.argv.length !== 2) throw new Error('Usage: npm run build (no extra build arguments).');
const npmVersion = npm(frontend, ['--version']).trim();
const dependencies = await dependencyState(root, npmVersion);
if (!await installedDependenciesMatch(root, dependencies) && !await adoptInstalledDependencies(root, dependencies)) {
  throw new Error('Installed packages differ from package-lock.json; run npm ci in frontend before building.');
}
const before = await frontendState(root, dependencies.buildKey);
for (const [script, args] of [
  ['typescript/bin/tsc', ['--noEmit']],
  ['vite/bin/vite.js', ['build']],
]) execFileSync(process.execPath, [join(frontend, 'node_modules', script), ...args], { cwd: frontend, windowsHide: true, stdio: 'inherit' });
const finalDependencies = await dependencyState(root, npmVersion);
const after = await frontendState(root, finalDependencies.buildKey);
if (before.key !== after.key || dependencies.installedLock !== finalDependencies.installedLock) {
  throw new Error('Frontend inputs changed during build; build receipt was not updated.');
}
await rememberFrontend(root, after);
console.log('Frontend build receipt saved for release reuse.');
