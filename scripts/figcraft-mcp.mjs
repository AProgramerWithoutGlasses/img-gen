// Launch/reuse the desktop app, then let the official CLI speak MCP directly on stdio.
// Never print startup logs to stdout: it belongs to the MCP protocol.
import { spawn } from 'node:child_process';
import { ensureApp, root, settings } from './lib/figcraft.mjs';

try {
  await ensureApp();
  const bridge = spawn(settings.cli, ['mcp', '--attach', String(settings.controlPort), '--timeout', '90'], {
    cwd: root, windowsHide: true, stdio: 'inherit',
  });
  bridge.on('error', error => { console.error(error.message); process.exitCode = 1; });
  bridge.on('exit', code => { process.exitCode = code ?? 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => bridge.kill());
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
