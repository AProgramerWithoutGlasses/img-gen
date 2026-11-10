// Only inspect checked-out Git objects. No network or user-controlled shell interpolation.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
const base = process.env.CHANGE_BASE;
const head = process.env.CHANGE_HEAD;
const ref = value => typeof value === 'string' && /^[a-f0-9]{40,64}$/i.test(value) && !/^0+$/.test(value);
const checks = { frontend: false, backend: false, integration: false, tools: false, docs: true };
const all = () => Object.assign(checks, { frontend: true, backend: true, integration: true, tools: true });
const frontend = () => Object.assign(checks, { frontend: true, integration: true });
const backend = () => Object.assign(checks, { backend: true, integration: true });

function classify(path) {
  // Shared build/CI entry points can change how every lane runs.
  if (/^\.github\/(?:workflows|actions)\//.test(path)
    || /^(?:package\.json|package-lock\.json|\.npmrc|docs\/api-contract\.md)$/.test(path)
    || /^scripts\/(?:ci-scope\.mjs|prepare-release\.mjs|lib\/frontend-build\.mjs)$/.test(path)) {
    all();
  } else if (/^frontend\/(?:src|public)\//.test(path)) {
    // Markdown/assets inside frontend sources may be bundled, so location wins over extension.
    frontend();
  } else if (/^(?:web|tests\/fixtures)\//.test(path)) {
    backend();
  } else if (/\.md$/i.test(path) || /^(?:docs|design|archive|research|marathon-design-research)\//.test(path)) {
    // Documentation and design sources do not change the shipped application.
  } else if (/^frontend\/(?:scripts|tests)\//.test(path)
    || /^frontend\/(?:index\.html|package(?:-lock)?\.json|\.npmrc|vite\.config\.[^/]+|tsconfig[^/]*\.json)$/.test(path)) {
    frontend();
  } else if (/^(?:internal|tests\/go)\//.test(path) || /^(?:go\.mod|go\.sum|[^/]+\.go)$/.test(path)) {
    backend();
  } else if (/^(?:scripts|tests\/(?:tools|design))\//.test(path) || path === 'figcraft.config.json') {
    checks.tools = true;
  } else {
    // New or unrecognised inputs must not silently skip required checks.
    all();
  }
}

if (ref(base) && ref(head)) {
  try {
    // Treat renames as delete+add so both old and new owners are checked.
    const paths = execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', base, head], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    }).split('\0').filter(Boolean);
    for (const path of paths) classify(path);
  } catch { all(); }
} else all();

const result = { business: checks.frontend || checks.backend || checks.integration, ...checks };
console.log(`Check scopes: ${Object.entries(result).map(([name, required]) => `${name}=${required}`).join(', ')}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
  Object.entries(result).map(([name, required]) => `${name}=${required}\n`).join(''));
