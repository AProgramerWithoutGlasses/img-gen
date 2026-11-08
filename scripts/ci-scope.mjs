// Only inspect checked-out Git objects. No network or user-controlled shell interpolation.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
const base = process.env.CHANGE_BASE;
const head = process.env.CHANGE_HEAD;
const ref = value => typeof value === 'string' && /^[a-f0-9]{40,64}$/i.test(value) && !/^0+$/.test(value);
let business = true;
if (ref(base) && ref(head)) {
 try {
  const paths = execFileSync('git', ['diff', '--name-only', '-z', base, head], { encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean);
  business = paths.some(path => !(/\.md$/i.test(path) || /^(docs|design|archive|research|marathon-design-research)\//.test(path)));
 } catch { business = true; }
}
console.log(`Business checks required: ${business}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `business=${business}\n`);
