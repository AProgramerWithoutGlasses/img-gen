import { mkdir } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

// Parse everything before creating a directory or starting Vite/a browser.
export function evidenceOptions(args, { defaultDirectory, booleanFlags = [] }) {
  const flags = new Set();
  let directory;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--output-dir') {
      if (directory !== undefined) throw new Error('--output-dir may only be specified once.');
      const value = args[++index];
      if (typeof value !== 'string' || !value.trim() || value.startsWith('-') || /[\x00-\x1f]/.test(value)) {
        throw new Error('--output-dir requires a directory path.');
      }
      directory = value;
    } else if (booleanFlags.includes(argument)) {
      if (flags.has(argument)) throw new Error(`${argument} may only be specified once.`);
      flags.add(argument);
    } else {
      throw new Error(`Unknown option: ${argument}. Use --output-dir <path>${booleanFlags.length ? ` or ${booleanFlags.join(', ')}` : ''}.`);
    }
  }
  const path = resolve(repositoryRoot, directory ?? defaultDirectory);
  return { path, url: pathToFileURL(path.endsWith(sep) ? path : path + sep), flags };
}

export async function prepareEvidenceOutput(args, options) {
  const result = evidenceOptions(args, options);
  await mkdir(result.path, { recursive: true });
  return result;
}
