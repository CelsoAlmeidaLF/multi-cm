// multi-cm/tests/margin-padding-standardization-test-runner.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

console.log('======================================================================');
console.log('📏 [QA/UI] - VALIDAÇÃO DETERMINÍSTICA DE PADDING E MARGIN NOS COMPONENTES');
console.log('======================================================================');

const rootDir = fs.existsSync('multi-cm/src') ? 'multi-cm' : '.';
const cssDir = path.resolve(rootDir, 'src/css');
const themeCss = fs.readFileSync(path.join(cssDir, 'theme.css'), 'utf-8');
const layoutCss = fs.readFileSync(path.join(cssDir, 'layout.css'), 'utf-8');
const componentsCss = fs.readFileSync(path.join(cssDir, 'components.css'), 'utf-8');
const allCss = `${themeCss}\n${layoutCss}\n${componentsCss}`;

const requiredComponentRules = [
  { name: '.form-actions (margin/gap)', check: (css) => /\.form-actions\s*\{[^}]*\}/s.test(css) && /margin-top:/.test(css.match(/\.form-actions\s*\{[^}]*\}/s)?.[0] || '') && /gap:/.test(css.match(/\.form-actions\s*\{[^}]*\}/s)?.[0] || '') },
  { name: '.mesa-entry (padding)', check: (css) => /padding:/.test(css.match(/\.mesa-entry\s*\{[^}]*\}/s)?.[0] || '') },
  { name: '.small-list (gap/margin)', check: (css) => /gap:/.test(css.match(/\.small-list\s*\{[^}]*\}/s)?.[0] || '') && /margin-top:/.test(css.match(/\.small-list\s*\{[^}]*\}/s)?.[0] || '') },
  { name: '.mini-grid (margin/gap)', check: (css) => /gap:/.test(css.match(/\.mini-grid\s*\{[^}]*\}/s)?.[0] || '') && /margin:/.test(css.match(/\.mini-grid\s*\{[^}]*\}/s)?.[0] || '') },
  { name: '.product-list-details (gap)', check: (css) => /gap:/.test(css.match(/\.product-list-details\s*\{[^}]*\}/s)?.[0] || '') },
  { name: '.product-list-right (margin)', check: (css) => /margin-top:/.test(css.match(/\.product-list-right\s*\{[^}]*\}/s)?.[0] || '') },
  { name: '.cash-quick-label (margin)', check: (css) => /margin:/.test(css.match(/\.cash-quick-label\s*\{[^}]*\}/s)?.[0] || '') },
  { name: '.cash-quick-select (margin/padding)', check: (css) => /margin-bottom:/.test(css.match(/\.cash-quick-select\s*\{[^}]*\}/s)?.[0] || '') && /padding:/.test(css.match(/\.cash-quick-select\s*\{[^}]*\}/s)?.[0] || '') },
  { name: '.cash-quick-notice (margin)', check: (css) => /margin-top:/.test(css.match(/\.cash-quick-notice\s*\{[^}]*\}/s)?.[0] || '') },
  { name: '.bio-diagnostic (padding/margin)', check: (css) => /padding:/.test(css.match(/\.bio-diagnostic\s*\{[^}]*\}/s)?.[0] || '') && /margin:/.test(css.match(/\.bio-diagnostic\s*\{[^}]*\}/s)?.[0] || '') },
  { name: '.bio-login-help (margin)', check: (css) => /margin:/.test(css.match(/\.bio-login-help\s*\{[^}]*\}/s)?.[0] || '') },
  { name: '.sku-help (margin)', check: (css) => /margin-top:/.test(css.match(/\.sku-help\s*\{[^}]*\}/s)?.[0] || '') },
  { name: '.modal-content > h2 / card > h2 (margin)', check: (css) => /margin:/.test(css.match(/\.modal-content\s*>\s*h2,\s*\.modal-content\s*>\s*\.card\s*>\s*h2\s*\{[^}]*\}/s)?.[0] || '') },
  { name: '.stack (margin/gap)', check: (css) => /gap:/.test(css.match(/\.stack\s*\{[^}]*\}/s)?.[0] || '') && /margin-top:/.test(css.match(/\.stack\s*\{[^}]*\}/s)?.[0] || '') },
  { name: '.inline-fields (margin/gap)', check: (css) => /gap:/.test(css.match(/\.inline-fields\s*\{[^}]*\}/s)?.[0] || '') && /margin:/.test(css.match(/\.inline-fields\s*\{[^}]*\}/s)?.[0] || '') },
  { name: '.btn.minor (padding)', check: (css) => /padding:/.test(css.match(/\.btn\.minor\s*\{[^}]*\}/s)?.[0] || '') }
];

for (const rule of requiredComponentRules) {
  assert.ok(rule.check(allCss), `[SPACING_DEFECT] Regra de espaçamento/margem ausente para: ${rule.name}`);
  console.log(`✅ [PASS] Espaçamento dimensional validado: ${rule.name}`);
}

console.log('======================================================================');
console.log('🎉 TODOS OS COMPONENTES AUDITADOS POSSUEM MARGENS E PADDINGS PADRONIZADOS!');
console.log('======================================================================');
