// Testes do pacote stk-pkt-governanca sobre a cópia em src/stk-pkt-governanca (mesmo arquivo do pacote).
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const r = spawnSync(process.execPath, ['--test', join(dir, 'stk-pkt-governanca.test.mjs')], { stdio: 'inherit' });
process.exit(r.status ?? 1);
