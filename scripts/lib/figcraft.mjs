import { execFile, spawn } from 'node:child_process';
import { access, mkdir, open, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile);
export const root = fileURLToPath(new URL('../../', import.meta.url));
const sharedSettings = JSON.parse(await readFile(resolve(root, 'figcraft.config.json'), 'utf8'));
let localSettings = {};
try { localSettings = JSON.parse(await readFile(resolve(root, 'figcraft.local.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
export const settings = { ...sharedSettings, ...localSettings };
settings.app = process.env.FIGCRAFT_APP || settings.app;
settings.cli = process.env.FIGCRAFT_CLI || settings.cli;
export const documentPath = resolve(root, settings.document);
export const output = resolve(root, 'outputs');
export const design = resolve(root, 'design');
if (!Number.isInteger(settings.controlPort) || settings.controlPort < 1024 || settings.controlPort > 65535) {
  throw new Error('figcraft.config.json: invalid controlPort');
}

export async function prepare() {
  await Promise.all([access(settings.app), access(settings.cli), access(documentPath), mkdir(output, { recursive: true })]);
}

export const fileRoots = ['--automation-read-root', root, '--automation-write-root', design, '--automation-write-root', output];

export async function cli(args) {
  const { stdout, stderr } = await exec(settings.cli, args, {
    cwd: root, windowsHide: true, timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

async function listener() {
  const script = '$c = Get-NetTCPConnection -LocalPort $env:UI_STUDIO_FIGCRAFT_PORT -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)" -ErrorAction Stop | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress }; exit 0';
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, timeout: 15_000, env: { ...process.env, UI_STUDIO_FIGCRAFT_PORT: String(settings.controlPort) },
  });
  return stdout.trim() ? JSON.parse(stdout) : null;
}

const normalized = value => value.replaceAll('/', '\\').replace(/[\\]+$/, '').toLowerCase();
function validateListener(process) {
  const tokens = (process.CommandLine?.match(/"[^"]*"|[^\s]+/g) ?? []).map(token => token.replace(/^"|"$/g, ''));
  const hasPair = (flag, value) => tokens.some((token, i) => token === flag && normalized(tokens[i + 1] ?? '') === normalized(value));
  if (normalized(process.ExecutablePath ?? '') !== normalized(settings.app)
    || !hasPair('--control', String(settings.controlPort))
    || !hasPair('--automation-read-root', root)
    || !hasPair('--automation-write-root', design)
    || !hasPair('--automation-write-root', output)) {
    throw new Error(`Port ${settings.controlPort} is occupied by another app or a FigCraft session with different roots; it was not stopped. Use another controlPort or close that session after saving.`);
  }
}

export async function ensureApp() {
  await prepare();
  let owner = await listener();
  if (owner) { validateListener(owner); return { pid: owner.ProcessId, reused: true }; }
  await mkdir(resolve(output, 'figcraft'), { recursive: true });
  const log = await open(resolve(output, 'figcraft/app.log'), 'a');
  const app = spawn(settings.app, ['--control', String(settings.controlPort), ...fileRoots, documentPath], {
    cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd],
  });
  try { await new Promise((yes, no) => { app.once('spawn', yes); app.once('error', no); }); }
  finally { await log.close(); }
  app.unref();
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await delay(300);
    owner = await listener();
    if (owner) { validateListener(owner); return { pid: owner.ProcessId, reused: false }; }
    if (app.exitCode !== null) throw new Error(`FigCraft exited with ${app.exitCode}; see outputs/figcraft/app.log`);
  }
  throw new Error('FigCraft did not open its control port; see outputs/figcraft/app.log');
}

export async function connect({ headless = false } = {}) {
  await prepare();
  if (!headless) await ensureApp();
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/stdio.js'),
  ]);
  const transport = new StdioClientTransport({
    command: settings.cli,
    args: headless ? ['mcp', ...fileRoots] : ['mcp', '--attach', String(settings.controlPort), '--timeout', '90'],
    cwd: root, stderr: 'pipe',
  });
  const client = new Client({ name: 'UI Studio', version: '1.0.0' });
  let diagnostics = '';
  transport.stderr?.on('data', data => { diagnostics = (diagnostics + data).slice(-4000); });
  try { await client.connect(transport); }
  catch (error) { await transport.close(); throw new Error(`${error.message}\n${diagnostics}`); }
  return client;
}

export async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 100_000 });
  if (result.isError) throw new Error(`${name}: ${result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')}`);
  return result;
}

export function data(result) {
  const text = result.content.find(part => part.type === 'text')?.text;
  if (!text) throw new Error('Expected a JSON result from FigCraft');
  return JSON.parse(text);
}

export const command = async (client, name, params = {}, document) => data(await call(client, 'run_command', {
  command: name, params, ...(document === undefined ? {} : { document }),
}));
