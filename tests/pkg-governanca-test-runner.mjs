// Testes do pacote stk-pkg-governanca sobre a cópia em src/stk-pkg-governanca (mesmo arquivo do pacote).
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const r = spawnSync(process.execPath, ['--test', join(dir, 'stk-pkg-governanca.test.mjs')], { stdio: 'inherit' });
process.exit(r.status ?? 1);
