// Executa todos os runners *-test-runner.mjs em processos isolados e falha se qualquer um falhar.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const runners = readdirSync(dir).filter(f => f.endsWith('-test-runner.mjs')).sort();
const falhas = [];

for (const runner of runners) {
  const r = spawnSync(process.execPath, [join(dir, runner)], { stdio: 'inherit' });
  if (r.status !== 0) falhas.push(runner);
}

console.log(`\n${runners.length - falhas.length}/${runners.length} runners aprovados.`);
if (falhas.length) {
  console.error(`Falharam: ${falhas.join(', ')}`);
  process.exit(1);
}
