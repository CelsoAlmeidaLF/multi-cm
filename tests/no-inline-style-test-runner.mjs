// Guarda do Design System: todo CSS fica nos .css. Nada de style="", <style>, cssText ou setAttribute('style')
// no HTML nem em strings/DOM dos scripts do app. Valor calculado em execução entra por custom property
// (el.style.setProperty('--x', v)) com a regra no .css.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

console.log('======================================================================');
console.log('🎨 [QA/UI] - SEM ESTILO INLINE: CSS SÓ NOS ARQUIVOS .css');
console.log('======================================================================');

const root = path.resolve(import.meta.dirname, '..');
const lerHtml = (rel) => fs.readFileSync(path.join(root, rel), 'utf-8');

for (const rel of ['src/index.html', 'docs/design-system.html']) {
  const html = lerHtml(rel);
  assert.ok(!/\sstyle\s*=/i.test(html), `[CSS_INLINE] ${rel} tem atributo style=""`);
  assert.ok(!/<style[\s>]/i.test(html), `[CSS_INLINE] ${rel} tem bloco <style>`);
  console.log(`✅ [PASS] ${rel} sem style="" e sem <style>`);
}

// Scripts do app (o kit stk-pkt-* é do pacote e fica de fora; o BinaryExportAdapter monta XML do Excel, não HTML)
const ignorar = (f) => path.basename(f).startsWith('stk-pkt-') || f.includes(`${path.sep}stk-pkt-governanca${path.sep}`) || path.basename(f) === 'BinaryExportAdapter.js';
function listar(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listar(p) : p.endsWith('.js') ? [p] : [];
  });
}
const padroes = [
  [/\sstyle\s*=\s*["'\\]/, 'atributo style="" em string HTML'],
  [/\.style\.cssText/, 'style.cssText'],
  [/setAttribute\(\s*['"]style['"]/, "setAttribute('style')"],
  [/\.style\.(?!setProperty|removeProperty)[a-zA-Z]+\s*=/, 'atribuição direta em .style.<propriedade>'],
];
for (const f of listar(path.join(root, 'src/js')).filter((x) => !ignorar(x))) {
  const src = fs.readFileSync(f, 'utf-8');
  for (const [re, nome] of padroes) {
    assert.ok(!re.test(src), `[CSS_INLINE] ${path.relative(root, f)}: ${nome}`);
  }
}
console.log('✅ [PASS] Scripts do app sem estilo inline (só custom property via setProperty)');

console.log('======================================================================');
console.log('🎉 NENHUM ESTILO INLINE FORA DOS ARQUIVOS .css!');
console.log('======================================================================');
