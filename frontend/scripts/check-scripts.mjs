import { fileURLToPath } from 'node:url';
import { checkScripts } from '../../scripts/check-scripts.mjs';

await checkScripts(fileURLToPath(new URL('../', import.meta.url)));
