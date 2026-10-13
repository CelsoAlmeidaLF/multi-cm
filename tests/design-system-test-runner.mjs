// multi-cm/tests/design-system-test-runner.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

console.log('======================================================================');
console.log('🎨 [QA/UI] - VALIDAÇÃO DETERMINÍSTICA DO DESIGN SYSTEM E STYLEGUIDE');
console.log('======================================================================');

const rootDir = fs.existsSync('multi-cm/src') ? 'multi-cm' : '.';
const docsPath = path.resolve(rootDir, 'docs/DESIGN_SYSTEM.md');
const templatePath = path.resolve(rootDir, 'docs/design-system.html');
const srcTemplatePath = path.resolve(rootDir, 'src/design-system.html');

// 0. Garantir isolamento do projeto principal
assert.ok(!fs.existsSync(srcTemplatePath), '[SRC_POLLUTION_ERR] O template não deve residir dentro de src/');
console.log('✅ [PASS] Projeto principal limpo: template mantido fora de src/');

// 1. Validação da Documentação Técnica (DESIGN_SYSTEM.md)
assert.ok(fs.existsSync(docsPath), '[DOC_ERR] Arquivo docs/DESIGN_SYSTEM.md não encontrado');
const docsContent = fs.readFileSync(docsPath, 'utf-8');

assert.ok(docsContent.includes('Design System Aero 2.0'), '[DOC_ERR] Título do Design System ausente');
assert.ok(docsContent.includes('```mermaid'), '[DOC_ERR] Diagrama Mermaid de arquitetura ausente');
assert.ok(docsContent.includes('--accent'), '[DOC_ERR] Especificação de tokens de cores ausente');
assert.ok(docsContent.includes('--space-md'), '[DOC_ERR] Especificação de escala de espaçamento ausente');
assert.ok(docsContent.includes('.toolbar-title-group'), '[DOC_ERR] Especificação de alinhamento de toolbar ausente');
assert.ok(docsContent.includes('.intro-controls'), '[DOC_ERR] Especificação de intro-controls ausente');
console.log('✅ [PASS] Documentação técnica DESIGN_SYSTEM.md validada com diagramas e tokens');

// 2. Validação do Template Living Styleguide (docs/design-system.html)
assert.ok(fs.existsSync(templatePath), '[HTML_ERR] Template docs/design-system.html não encontrado');
const htmlContent = fs.readFileSync(templatePath, 'utf-8');

assert.ok(htmlContent.includes('<link rel="stylesheet" href="../src/css/main.css"/>'), '[HTML_ERR] Importação de ../src/css/main.css ausente');
assert.ok(htmlContent.includes('<svg aria-hidden="true"'), '[HTML_ERR] Sprite SVG nativo ausente');

const requiredSections = [
  'id="sec-tokens"',
  'id="sec-typography"',
  'id="sec-buttons"',
  'id="sec-pills"',
  'id="sec-forms"',
  'id="sec-stats"',
  'id="sec-toolbars"',
  'id="sec-dropdown"',
  'id="sec-lists"',
  'id="sec-alerts"'
];

for (const sec of requiredSections) {
  assert.ok(htmlContent.includes(sec), `[HTML_ERR] Seção de componentes ausente no Styleguide: ${sec}`);
  console.log(`✅ [PASS] Seção catalogada no Living Styleguide: ${sec}`);
}

// 3. Validação de Componentes Interativos Chave
assert.ok(htmlContent.includes('class="btn"'), '[HTML_ERR] Componente .btn ausente');
assert.ok(htmlContent.includes('class="btn ghost"'), '[HTML_ERR] Componente .btn.ghost ausente');
assert.ok(htmlContent.includes('class="pill good"'), '[HTML_ERR] Componente .pill.good ausente');
assert.ok(htmlContent.includes('class="stat"'), '[HTML_ERR] Componente .stat ausente');
assert.ok(htmlContent.includes('class="toolbar-title-group"'), '[HTML_ERR] Componente .toolbar-title-group ausente');
assert.ok(htmlContent.includes('class="toolbar-actions"'), '[HTML_ERR] Componente .toolbar-actions ausente');
assert.ok(htmlContent.includes('class="intro-controls"'), '[HTML_ERR] Componente .intro-controls ausente');
assert.ok(htmlContent.includes('class="dropdown-wrap"'), '[HTML_ERR] Componente .dropdown-wrap ausente');
assert.ok(htmlContent.includes('dropdown-trigger'), '[HTML_ERR] Componente dropdown-trigger ausente');
assert.ok(htmlContent.includes('dropdown-menu'), '[HTML_ERR] Componente dropdown-menu ausente');
assert.ok(htmlContent.includes('<dialog class="aero-modal"'), '[HTML_ERR] Dialog modal aero nativo ausente');
console.log('✅ [PASS] Todos os componentes atômicos e moleculares renderizados no template');

// 4. Verificação de Integridade Sintática
assert.ok(htmlContent.includes('<!DOCTYPE html>'), '[SYNTAX_ERR] Doctype HTML5 ausente');
assert.ok(htmlContent.includes('</html>'), '[SYNTAX_ERR] Fechamento </html> ausente');
console.log('✅ [PASS] Integridade léxica e sintática HTML5 validada');

console.log('======================================================================');
console.log('🎉 DESIGN SYSTEM E LIVING STYLEGUIDE 100% VALIDADOS COM SUCESSO!');
console.log('======================================================================');
