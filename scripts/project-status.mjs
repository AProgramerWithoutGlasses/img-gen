// Local status by default. --remote only reads origin refs; never pushes or deploys.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
function git(root, args) {
  return new Promise((yes, no) => execFile('git', args, {
    cwd: root, windowsHide: true, timeout: 12000, maxBuffer: 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
  }, (error, stdout, stderr) => {
    if (!error) return yes(stdout.trim());
    // Do not print raw Git stderr: remote URLs can contain credentials.
    const reason = error.killed ? 'timeout'
      : /Could not resolve proxy|Failed to connect to (127\.0\.0\.1|localhost)/i.test(stderr) ? 'proxy'
      : /Could not resolve host/i.test(stderr) ? 'dns'
      : error.code === 2 && args[0] === 'ls-remote' ? 'repository-or-auth'
      : /Authentication failed|could not read Username|repository.*not found|not a git repository|does not appear to be a git repository|could not read from remote repository/i.test(stderr) ? 'repository-or-auth'
      : /SSL|certificate|schannel/i.test(stderr) ? 'tls' : 'network';
    no(Object.assign(new Error(`Git ${args[0]} failed (${reason})`), { reason }));
  }));
}
async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}
export async function collectStatus({ root = projectRoot, remote = false } = {}) {
  const [branch, commit, changes, upstream] = await Promise.all([
    git(root, ['branch', '--show-current']), git(root, ['rev-parse', 'HEAD']),
    git(root, ['status', '--short']),
    git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).catch(() => null),
  ]);
  const counts = upstream
    ? (await git(root, ['rev-list', '--left-right', '--count', `HEAD...${upstream}`])).split(/\s+/).map(Number)
    : null;
  const designSettings = JSON.parse(await readFile(resolve(root, 'figcraft.config.json'), 'utf8'));
  if (typeof designSettings.document !== 'string' || !designSettings.document.trim()) {
    throw new Error('figcraft.config.json: document must name the working design file');
  }
  const designPath = resolve(root, designSettings.document);
  const designBytes = await readFile(designPath).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const result = {
    root: resolve(root), branch: branch || '(detached)', commit, upstream,
    ahead: counts?.[0] ?? null, behind: counts?.[1] ?? null,
    changes: changes ? changes.split(/\r?\n/) : [],
    dependencies: {
      design: await exists(resolve(root, 'node_modules/@modelcontextprotocol/sdk/package.json')),
      frontend: await exists(resolve(root, 'frontend/node_modules/vite/package.json'))
        && await exists(resolve(root, 'frontend/node_modules/typescript/package.json')),
    },
    design: { path: designPath, savedBytes: designBytes?.length ?? null,
      sha256: designBytes ? createHash('sha256').update(designBytes).digest('hex') : null },
    embeddedFrontend: await exists(resolve(root, 'web/studio/index.html')),
  };
  if (remote) {
    try {
      const refs = await git(root, ['ls-remote', '--exit-code', 'origin', 'refs/heads/main']);
      const remoteCommit = refs.split(/\s+/)[0];
      result.remote = { reachable: true, main: remoteCommit,
        matchesLocalTracking: upstream === 'origin/main'
          ? remoteCommit === await git(root, ['rev-parse', 'origin/main']) : null };
    } catch (error) {
      const hints = {
        timeout: '连接超时，检查本机代理服务和 Git 代理配置。',
        proxy: '本机代理不可用，检查代理程序是否运行、监听端口是否变化。',
        dns: '域名解析失败，检查 DNS 或 Git 代理配置。',
        'repository-or-auth': '检查远程仓库地址、main 分支及 Git 凭据。',
        tls: 'TLS 或证书校验失败，检查代理和证书；不要关闭 SSL 校验。',
        network: '网络连接失败，检查本机代理服务和 Git 代理配置。',
      };
      result.remote = { reachable: false, reason: error.reason ?? 'network',
        error: `无法读取 origin/main：${hints[error.reason] ?? hints.network}未执行推送。` };
    }
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = process.argv.slice(2);
    if (options.some(option => !['--remote', '--json'].includes(option))) {
      throw new Error('Usage: npm run status -- [--remote] [--json]');
    }
    const result = await collectStatus({ remote: options.includes('--remote') });
    if (options.includes('--json')) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`目录：${result.root}\n分支：${result.branch} @ ${result.commit.slice(0, 7)}`);
      console.log(result.upstream ? `跟踪：${result.upstream}，领先 ${result.ahead}，落后 ${result.behind}（本地记录）` : '跟踪：未配置');
      console.log(`工作区：${result.changes.length ? '\n' + result.changes.join('\n') : '干净'}`);
      console.log(`依赖存在：前端 ${result.dependencies.frontend ? '是' : '否'}，设计工具 ${result.dependencies.design ? '是' : '否'}`);
      console.log(`已保存原稿：${result.design.savedBytes ?? '不存在'} 字节；未读取桌面未保存状态`);
      console.log(`Go 嵌入前端产物：${result.embeddedFrontend ? '存在（未校验新旧）' : '缺失，先 npm run build'}`);
      if (result.remote) console.log(result.remote.reachable
        ? `远程 main：${result.remote.main.slice(0, 7)}${result.remote.matchesLocalTracking === false ? '，本地跟踪记录已过时，请 git fetch origin' : ''}`
        : result.remote.error);
    }
    if (result.remote?.reachable === false) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
