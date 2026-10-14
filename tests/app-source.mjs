// Fonte da camada de UI da aplicação: App.js + controllers extraídos em ui/controllers.
// Os runners que verificam a presença de handlers/métodos leem o conjunto, não só App.js.
import fs from 'node:fs';
import path from 'node:path';

export function readAppSource(rootDir) {
  const jsDir = path.resolve(rootDir, 'src/js');
  const ctrlDir = path.join(jsDir, 'ui/controllers');
  const files = [path.join(jsDir, 'App.js')];
  if (fs.existsSync(ctrlDir)) {
    for (const f of fs.readdirSync(ctrlDir).sort()) {
      if (f.endsWith('.js')) files.push(path.join(ctrlDir, f));
    }
  }
  return files.map(f => fs.readFileSync(f, 'utf-8')).join('\n');
}
